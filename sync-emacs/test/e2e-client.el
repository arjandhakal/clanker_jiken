;;; e2e-client.el --- Real socket client smoke test -*- lexical-binding: t; -*-
(require 'sync-emacs)
(require 'ert)

(defun sync-emacs-e2e--wait (predicate)
  (let ((deadline (+ (float-time) 5)))
    (while (not (funcall predicate))
      (when (> (float-time) deadline) (error "Timed out in Emacs socket smoke test"))
      (accept-process-output nil 0.02))))

(defun sync-emacs-e2e--connect (name)
  (let ((completing-read-function
         (lambda (_prompt choices &rest _)
           (car (cl-find-if (lambda (choice) (string-prefix-p name (car choice))) choices)))))
    (connect-pi))
  (let ((buffer (current-buffer)))
    (sync-emacs-e2e--wait (lambda () (sync-emacs--live-p buffer)))
    buffer))

(let* ((alpha (sync-emacs-e2e--connect "Alpha"))
       (beta (sync-emacs-e2e--connect "Beta")) draft)
  (should-not (eq alpha beta))
  (set-buffer alpha)
  (should (string-match-p "Alpha history" (buffer-string)))
  (sync-emacs-compose)
  (setq draft (current-buffer))
  (insert "Hello 日本語 🌸\nfrom Emacs")
  (sync-emacs-send)
  (sync-emacs-e2e--wait (lambda () (with-current-buffer draft (not sync-emacs--pending-id))))
  (should (equal (with-current-buffer draft (buffer-string)) ""))
  (sync-emacs-e2e--wait
   (lambda () (with-current-buffer alpha (string-match-p "Hello 日本語 🌸" (buffer-string)))))
  (should-not (with-current-buffer beta (string-match-p "Hello 日本語 🌸" (buffer-string))))
  (with-temp-buffer
    (setq buffer-file-name "/project/unsaved.txt"
          sync-emacs--target beta)
    (insert "Unsaved buffer contents")
    (sync-emacs-send-buffer "Review this"))
  (sync-emacs-e2e--wait
   (lambda () (with-current-buffer beta (string-match-p "Unsaved buffer contents" (buffer-string)))))
  (should-not (with-current-buffer alpha (string-match-p "Unsaved buffer contents" (buffer-string))))
  (with-current-buffer beta (sync-emacs-abort))
  (sync-emacs-e2e--wait
   (lambda () (with-current-buffer beta (string-match-p "abort received" (buffer-string)))))
  (with-current-buffer alpha (sync-emacs-disconnect))
  (should (sync-emacs--live-p beta))
  ;; Reconnect to the same still-running instance; restore from its snapshot.
  (should (eq alpha (sync-emacs-e2e--connect "Alpha")))
  (should (with-current-buffer alpha (string-match-p "Hello 日本語 🌸" (buffer-string))))
  (with-current-buffer alpha (sync-emacs-disconnect))
  (with-current-buffer beta (sync-emacs-disconnect))
  (princ "Emacs socket integration passed\n"))
