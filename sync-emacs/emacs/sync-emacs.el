;;; sync-emacs.el --- Attach to running Pi sessions -*- lexical-binding: t; -*-

;; Version: 0.1.0
;; Package-Requires: ((emacs "27.1"))
;; Keywords: tools, processes

;;; Commentary:
;; Load the sync-emacs Pi extension in each terminal session, then run
;; M-x connect-pi.  This client never starts an agent or writes session files.
;; In the transcript, i opens a multiline composer; C-c C-c sends its text.

;;; Code:

(require 'cl-lib)
(require 'json)
(require 'subr-x)

(defgroup sync-emacs nil "Attach to Pi terminal sessions." :group 'tools)

(defcustom sync-emacs-directory
  (or (getenv "SYNC_EMACS_DIR") (format "/tmp/sync-emacs-%s" (user-uid)))
  "Private discovery directory used by the Pi extension.
Set SYNC_EMACS_DIR in Pi too if you customize this.  Local Unix sockets only."
  :type 'directory)

(defcustom sync-emacs-delivery "followUp"
  "Delivery of messages while Pi is busy.
\"followUp\" waits for the current work; \"steer\" steers at the next opportunity."
  :type '(choice (const "followUp") (const "steer")))

(defvar sync-emacs--connections nil)
(defvar sync-emacs--request-counter 0)
(defvar-local sync-emacs--process nil)
(defvar-local sync-emacs--session nil)
(defvar-local sync-emacs--ready nil)
(defvar-local sync-emacs--rows nil)
(defvar-local sync-emacs--pending nil)
(defvar-local sync-emacs--target nil)
(defvar-local sync-emacs--pending-id nil)
(defvar-local sync-emacs--snapshot-position nil)
(defvar-local sync-emacs--snapshot-windows nil)

(defun sync-emacs--get (key object) (alist-get key object))

(defun sync-emacs--json (string)
  (json-parse-string string :object-type 'alist :array-type 'list
                     :null-object nil :false-object :json-false))

(defun sync-emacs--live-p (buffer)
  (and (buffer-live-p buffer)
       (with-current-buffer buffer
         (and sync-emacs--ready (process-live-p sync-emacs--process)))))

(defun sync-emacs--label (session)
  (format "%s | %s | pid %s | %s"
          (or (sync-emacs--get 'name session) "unnamed")
          (sync-emacs--get 'cwd session)
          (sync-emacs--get 'pid session)
          (sync-emacs--get 'instanceId session)))

(defun sync-emacs--sessions ()
  "Read live, same-user discovery files; ignore stale or malformed records."
  (unless (and (file-directory-p sync-emacs-directory)
               (not (file-symlink-p (directory-file-name sync-emacs-directory)))
               (equal (file-attribute-user-id (file-attributes sync-emacs-directory)) (user-uid))
               (= 0 (logand #o077 (file-modes sync-emacs-directory))))
    (user-error "No private sync-emacs directory; install/load the Pi extension first"))
  (let (sessions)
    (dolist (file (directory-files sync-emacs-directory t "\\.json\\'"))
      (condition-case nil
          (when (and (not (file-symlink-p file))
                     (< (file-attribute-size (file-attributes file)) 65536))
            (let* ((session (with-temp-buffer
                              (insert-file-contents file)
                              (sync-emacs--json (buffer-string))))
                   (socket (sync-emacs--get 'socket session))
                   (pid (sync-emacs--get 'pid session)))
              (when (and (eql (sync-emacs--get 'protocol session) 1)
                         (stringp (sync-emacs--get 'instanceId session))
                         (stringp (sync-emacs--get 'sessionId session))
                         (stringp socket) (file-exists-p socket)
                         (not (file-symlink-p socket))
                         (equal (file-truename (file-name-directory socket))
                                (file-name-as-directory (file-truename sync-emacs-directory)))
                         (integerp pid) (process-attributes pid))
                (push session sessions))))
        (error nil)))
    (nreverse sessions)))

(defun sync-emacs--header ()
  (setq header-line-format
        (concat " Pi: " (or (sync-emacs--get 'name sync-emacs--session) "unnamed")
                " | " (or (sync-emacs--get 'cwd sync-emacs--session) "")
                " | " (cond ((not (process-live-p sync-emacs--process)) "disconnected")
                             ((not sync-emacs--ready) "connecting")
                             ((eq t (sync-emacs--get 'busy sync-emacs--session)) "working")
                             (t "idle"))
                " | i: compose   g: refresh   C-c C-k: abort"))
  (force-mode-line-update))

(defun sync-emacs--wire (process object)
  (let ((line (concat (json-encode object) "\n")))
    (when (> (string-bytes line) (* 1024 1024))
      (user-error "Message exceeds sync-emacs's 1 MiB wire limit; send a smaller region"))
    (process-send-string process line)))

(defun sync-emacs--request (buffer type &optional fields draft)
  "Send TYPE to BUFFER with FIELDS; retain DRAFT until dispatch is acknowledged."
  (unless (sync-emacs--live-p buffer) (user-error "Pi is disconnected; M-x connect-pi to reconnect"))
  (let ((id (number-to-string (cl-incf sync-emacs--request-counter))))
    (with-current-buffer buffer
      (puthash id draft sync-emacs--pending)
      (when (and draft (buffer-live-p (car draft)))
        (with-current-buffer (car draft) (setq sync-emacs--pending-id id)))
      (condition-case err
          (sync-emacs--wire sync-emacs--process
                            (append `((type . ,type) (id . ,id)
                                      (sessionId . ,(sync-emacs--get 'sessionId sync-emacs--session)))
                                    fields))
        (error
         (remhash id sync-emacs--pending)
         (when (and draft (buffer-live-p (car draft)))
           (with-current-buffer (car draft) (setq sync-emacs--pending-id nil)))
         (signal (car err) (cdr err)))))
    id))

(defun sync-emacs--upsert (row)
  "Insert or replace ROW without duplicating streaming output."
  (let* ((id (sync-emacs--get 'id row))
         (markers (gethash id sync-emacs--rows))
         (follow (= (point) (point-max)))
         (windows (cl-remove-if-not
                   (lambda (window) (>= (window-point window) (point-max)))
                   (get-buffer-window-list (current-buffer) nil t)))
         (inhibit-read-only t))
    (save-excursion
      (let ((start (if markers (marker-position (car markers)) (point-max))))
        (when markers (delete-region start (cdr markers)))
        (goto-char start)
        (insert (propertize (concat (or (sync-emacs--get 'role row) "Pi") "\n")
                            'face 'font-lock-keyword-face)
                (or (sync-emacs--get 'text row) "") "\n\n")
        (unless markers
          ;; Starts advance when a preceding row is replaced; ends do not grow
          ;; when a following row is appended.  Reset our own markers below.
          (setq markers (cons (copy-marker start t) (copy-marker (point) nil)))
          (puthash id markers sync-emacs--rows))
        (set-marker (car markers) start)
        (set-marker (cdr markers) (point))))
    (when follow (goto-char (point-max)))
    (dolist (window windows) (set-window-point window (point-max)))
    (set-buffer-modified-p nil)))

(defun sync-emacs--notice (text)
  (sync-emacs--upsert `((id . ,(format "notice:%s" (cl-incf sync-emacs--request-counter)))
                       (role . "sync-emacs") (text . ,text))))

(defun sync-emacs--response (frame)
  (let* ((id (sync-emacs--get 'id frame))
         (draft (gethash id sync-emacs--pending))
         (ok (eq t (sync-emacs--get 'ok frame))))
    (remhash id sync-emacs--pending)
    (when (and draft (buffer-live-p (car draft)))
      (with-current-buffer (car draft)
        (setq sync-emacs--pending-id nil)
        ;; Don't destroy edits made while the acknowledgement was in flight.
        (when (and ok (equal (buffer-substring-no-properties (point-min) (point-max)) (cdr draft)))
          (erase-buffer)
          (set-buffer-modified-p nil))))
    (if ok
        (message "Pi accepted request %s (dispatch acknowledged)" id)
      (let ((error-text (or (sync-emacs--get 'error frame) "unknown error")))
        (sync-emacs--notice (concat "Request failed: " error-text))
        (message "Pi: %s" error-text)))))

(defun sync-emacs--handle (frame)
  (pcase (sync-emacs--get 'type frame)
    ("hello"
     (unless (and (eql (sync-emacs--get 'protocol frame) 1)
                  (equal (sync-emacs--get 'instanceId (sync-emacs--get 'session frame))
                         (sync-emacs--get 'instanceId sync-emacs--session)))
       (error "Pi protocol/instance mismatch"))
     (setq sync-emacs--session (sync-emacs--get 'session frame))
     (sync-emacs--header))
    ("snapshot_start"
     (setq sync-emacs--snapshot-position (unless (= (point) (point-max)) (point))
           sync-emacs--snapshot-windows
           (mapcar (lambda (window)
                     (list window (window-point window) (window-start window)
                           (= (window-point window) (point-max))))
                   (get-buffer-window-list (current-buffer) nil t))
           sync-emacs--session (sync-emacs--get 'session frame))
     (let ((inhibit-read-only t)) (erase-buffer))
     (maphash (lambda (_id pair) (set-marker (car pair) nil) (set-marker (cdr pair) nil)) sync-emacs--rows)
     (clrhash sync-emacs--rows)
     (sync-emacs--header))
    ("snapshot_end"
     (goto-char (if sync-emacs--snapshot-position
                    (min sync-emacs--snapshot-position (point-max)) (point-max)))
     (dolist (saved sync-emacs--snapshot-windows)
       (pcase-let ((`(,window ,position ,start ,follow) saved))
         (when (and (window-live-p window) (eq (window-buffer window) (current-buffer)))
           (set-window-point window (if follow (point-max) (min position (point-max))))
           (unless follow (set-window-start window (min start (point-max)) t)))))
     (setq sync-emacs--snapshot-position nil sync-emacs--snapshot-windows nil sync-emacs--ready t)
     (sync-emacs--header)
     (set-buffer-modified-p nil))
    ("upsert" (sync-emacs--upsert (sync-emacs--get 'row frame)))
    ("state" (setq sync-emacs--session (sync-emacs--get 'session frame)) (sync-emacs--header))
    ("notice" (sync-emacs--notice (sync-emacs--get 'text frame)))
    ("response" (sync-emacs--response frame))
    (_ (error "Unknown sync-emacs frame"))))

(defun sync-emacs--filter (process chunk)
  (when (and (buffer-live-p (process-buffer process))
             (eq process (buffer-local-value 'sync-emacs--process (process-buffer process))))
    (with-current-buffer (process-buffer process)
      (condition-case err
          (let ((input (concat (or (process-get process 'sync-emacs-input) "") chunk)) end)
            (while (setq end (string-match "\n" input))
              (when (> end (* 8 1024 1024)) (error "Pi frame too large"))
              (sync-emacs--handle (sync-emacs--json (substring input 0 end)))
              (setq input (substring input (1+ end))))
            (when (> (string-bytes input) (* 8 1024 1024)) (error "Pi frame too large"))
            (process-put process 'sync-emacs-input input))
        (error
         (sync-emacs--notice (format "Protocol error: %s" (error-message-string err)))
         (delete-process process))))))

(defun sync-emacs--sentinel (process _event)
  (when (and (not (process-live-p process)) (buffer-live-p (process-buffer process)))
    (with-current-buffer (process-buffer process)
      (when (eq process sync-emacs--process)
        (setq sync-emacs--ready nil)
        (maphash (lambda (_id draft)
                   (when (and draft (buffer-live-p (car draft)))
                     (with-current-buffer (car draft) (setq sync-emacs--pending-id nil))))
                 sync-emacs--pending)
        (clrhash sync-emacs--pending)
        (sync-emacs--header)
        (sync-emacs--notice "Disconnected. Drafts were kept. M-x connect-pi to reconnect; check history before resending an unacknowledged message.")))))

(defun sync-emacs-disconnect ()
  "Disconnect this editor, leaving the terminal Pi session running."
  (interactive)
  (when (process-live-p sync-emacs--process) (delete-process sync-emacs--process)))

(defvar sync-emacs-mode-map
  (let ((map (make-sparse-keymap)))
    (set-keymap-parent map special-mode-map)
    (define-key map (kbd "i") #'sync-emacs-compose)
    (define-key map (kbd "g") #'sync-emacs-refresh)
    (define-key map (kbd "C-c C-k") #'sync-emacs-abort)
    (define-key map (kbd "C-c C-d") #'sync-emacs-disconnect)
    map))

(define-derived-mode sync-emacs-mode special-mode "Pi"
  "Read-only live Pi transcript.  Use `sync-emacs-compose' to write a message."
  (setq-local sync-emacs--rows (make-hash-table :test 'equal))
  (setq-local sync-emacs--pending (make-hash-table :test 'equal))
  (setq-local truncate-lines nil)
  (buffer-disable-undo)
  (add-hook 'kill-buffer-hook #'sync-emacs-disconnect nil t))

;;;###autoload
(defun connect-pi ()
  "Select and attach to an existing Pi terminal session."
  (interactive)
  (let* ((sessions (sync-emacs--sessions))
         (_ (unless sessions (user-error "No running Pi bridges found; load sync-emacs and /reload in Pi")))
         (choices (mapcar (lambda (session) (cons (sync-emacs--label session) session)) sessions))
         (session (cdr (assoc (completing-read "Connect Pi: " choices nil t) choices)))
         (instance (sync-emacs--get 'instanceId session))
         (existing (cl-find-if
                    (lambda (buffer)
                      (and (buffer-live-p buffer)
                           (with-current-buffer buffer
                             (equal instance (sync-emacs--get 'instanceId sync-emacs--session)))))
                    sync-emacs--connections))
         (buffer (or existing (generate-new-buffer
                               (format "*pi:%s:%s*" (or (sync-emacs--get 'name session) "chat") instance)))))
    (unless (sync-emacs--live-p buffer)
      (with-current-buffer buffer
        (sync-emacs-disconnect)
        (sync-emacs-mode)
        (setq sync-emacs--session session sync-emacs--ready nil)
        (condition-case err
            (progn
              (setq sync-emacs--process
                    (make-network-process :name (concat "pi-" instance) :buffer buffer
                                          :family 'local :service (sync-emacs--get 'socket session)
                                          :coding 'utf-8-unix :noquery t
                                          :filter #'sync-emacs--filter :sentinel #'sync-emacs--sentinel))
              (sync-emacs--wire sync-emacs--process
                                `((type . "hello") (protocol . 1) (instanceId . ,instance))))
          (error (sync-emacs-disconnect) (user-error "Cannot connect: %s" (error-message-string err))))
        (sync-emacs--header)))
    (cl-pushnew buffer sync-emacs--connections)
    (pop-to-buffer buffer)))

(defalias 'sync-emacs-connect #'connect-pi)

(defun sync-emacs--choose-connection (&optional always-ask)
  (setq sync-emacs--connections (cl-remove-if-not #'buffer-live-p sync-emacs--connections))
  (let ((live (cl-remove-if-not #'sync-emacs--live-p sync-emacs--connections)))
    (cond
     ((and (not always-ask) (derived-mode-p 'sync-emacs-mode))
      (if (sync-emacs--live-p (current-buffer)) (current-buffer)
        (user-error "This Pi is disconnected; M-x connect-pi")))
     ((and (not always-ask) sync-emacs--target)
      (if (sync-emacs--live-p sync-emacs--target) sync-emacs--target
        (user-error "Associated Pi is disconnected; reconnect or reassociate this buffer")))
     ((not live) (user-error "Connect first with M-x connect-pi"))
     ((and (not always-ask) (= (length live) 1)) (car live))
     (t (let ((choices (mapcar (lambda (buffer)
                                (cons (with-current-buffer buffer (sync-emacs--label sync-emacs--session)) buffer)) live)))
          (cdr (assoc (completing-read "Send to Pi: " choices nil t) choices)))))))

(defun sync-emacs-associate-session ()
  "Pin the current source buffer to one connected Pi session."
  (interactive)
  (setq-local sync-emacs--target (sync-emacs--choose-connection t))
  (message "Associated with %s" (buffer-name sync-emacs--target)))

(defvar sync-emacs-compose-mode-map
  (let ((map (make-sparse-keymap)))
    (set-keymap-parent map text-mode-map)
    (define-key map (kbd "C-c C-c") #'sync-emacs-send)
    (define-key map (kbd "C-c C-s") #'sync-emacs-send-steer)
    (define-key map (kbd "C-c C-k") #'sync-emacs-abort)
    map))

(define-derived-mode sync-emacs-compose-mode text-mode "Pi-Compose"
  "Multiline Pi message.  C-c C-c sends; C-c C-s steers; RET inserts a newline.")

(defun sync-emacs-compose ()
  "Open a multiline draft for the selected Pi session."
  (interactive)
  (let* ((target (sync-emacs--choose-connection))
         (name (format "*pi-compose:%s*" (buffer-name target)))
         (buffer (get-buffer-create name)))
    (with-current-buffer buffer
      (unless (derived-mode-p 'sync-emacs-compose-mode) (sync-emacs-compose-mode))
      (setq-local sync-emacs--target target)
      (setq header-line-format (format " Send to %s | C-c C-c: send | C-c C-s: steer" (buffer-name target))))
    (pop-to-buffer buffer)))

(defun sync-emacs-send (&optional steer)
  "Send this draft to Pi; with prefix STEER, steer instead of following up."
  (interactive "P")
  (unless (derived-mode-p 'sync-emacs-compose-mode) (user-error "Use a Pi compose buffer"))
  (when sync-emacs--pending-id (user-error "Waiting for dispatch acknowledgement"))
  (let ((text (buffer-substring-no-properties (point-min) (point-max)))
        (target (sync-emacs--choose-connection)))
    (when (string-empty-p (string-trim text)) (user-error "Message is empty"))
    (sync-emacs--request target "prompt"
                         `((text . ,text) (deliverAs . ,(if steer "steer" sync-emacs-delivery)))
                         (cons (current-buffer) text))))

(defun sync-emacs-send-steer ()
  "Send this draft as a steering message."
  (interactive)
  (sync-emacs-send t))

(defun sync-emacs--source-text (start end instruction)
  (let* ((source (or buffer-file-name (buffer-name)))
         (text (buffer-substring-no-properties start end))
         (fence-length 3) (offset 0))
    (while (string-match "`+" text offset)
      (setq fence-length (max fence-length (1+ (- (match-end 0) (match-beginning 0))))
            offset (match-end 0)))
    (let ((fence (make-string fence-length ?`)))
      (format "%s%sBuffer: %s (lines %s–%s)\n%s\n%s\n%s"
              instruction (if (string-empty-p instruction) "" "\n\n") source
              (line-number-at-pos start t) (line-number-at-pos (max start (1- end)) t)
              fence text fence))))

(defun sync-emacs-send-region (start end &optional instruction)
  "Send the selected text to Pi, optionally prefixed by INSTRUCTION.
This sends the actual buffer text, including unsaved edits."
  (interactive (list (region-beginning) (region-end) (read-string "Instruction (optional): ")))
  (when (= start end) (user-error "Region is empty"))
  (let ((text (sync-emacs--source-text start end (or instruction ""))))
    (sync-emacs--request (sync-emacs--choose-connection) "prompt"
                         `((text . ,text) (deliverAs . ,sync-emacs-delivery)))))

(defun sync-emacs-send-buffer (&optional instruction)
  "Send the accessible buffer, including unsaved edits, with INSTRUCTION.
Respects narrowing; does not save the file."
  (interactive (list (read-string "Instruction (optional): ")))
  (sync-emacs-send-region (point-min) (point-max) instruction))

(defun sync-emacs-abort ()
  "Ask the connected Pi session to abort its current operation."
  (interactive)
  (sync-emacs--request (sync-emacs--choose-connection) "abort"))

(defun sync-emacs-refresh ()
  "Refresh the attached transcript from the bridge."
  (interactive)
  (sync-emacs--request (sync-emacs--choose-connection) "snapshot"))

(provide 'sync-emacs)
;;; sync-emacs.el ends here
