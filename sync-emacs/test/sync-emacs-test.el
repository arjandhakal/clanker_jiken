;;; sync-emacs-test.el --- Tests for sync-emacs -*- lexical-binding: t; -*-
(require 'ert)
(require 'sync-emacs)

(defmacro sync-emacs-test--chat (&rest body)
  (declare (indent 0))
  `(let ((chat (generate-new-buffer " *sync-emacs-test*")))
     (unwind-protect
         (with-current-buffer chat
           (sync-emacs-mode)
           (setq sync-emacs--session '((instanceId . "test") (sessionId . "session") (cwd . "/project"))
                 sync-emacs--ready t
                 sync-emacs--process (make-pipe-process :name "sync-emacs-test" :buffer chat :noquery t))
           ,@body)
       (when (buffer-live-p chat) (kill-buffer chat)))))

(ert-deftest sync-emacs-streaming-replaces-rows-and-preserves-adjacent-markers ()
  (sync-emacs-test--chat
    (sync-emacs--upsert '((id . "a") (role . "assistant") (text . "one")))
    (sync-emacs--upsert '((id . "b") (role . "tool") (text . "tool text")))
    (sync-emacs--upsert '((id . "a") (role . "assistant") (text . "one two three")))
    (sync-emacs--upsert '((id . "b") (role . "tool") (text . "result")))
    (should (equal (buffer-string) "assistant\none two three\n\ntool\nresult\n\n"))
    (sync-emacs--upsert '((id . "a") (role . "assistant") (text . "short")))
    (sync-emacs--upsert '((id . "b") (role . "tool") (text . "longer result")))
    (should (equal (buffer-string) "assistant\nshort\n\ntool\nlonger result\n\n"))
    (should (= (point) (point-max)))
    (goto-char 2)
    (sync-emacs--upsert '((id . "b") (role . "tool") (text . "changed")))
    (should (= (point) 2))
    (should buffer-read-only)
    (should-not (buffer-modified-p))))

(ert-deftest sync-emacs-filter-frames-partial-and-coalesced-input ()
  (sync-emacs-test--chat
    (let* ((frame '((type . "upsert") (row . ((id . "a") (role . "assistant") (text . "日本語\n🌸")))))
           (wire (concat (json-encode frame) "\n")))
      (sync-emacs--filter sync-emacs--process (substring wire 0 9))
      (should (equal (buffer-string) ""))
      (sync-emacs--filter sync-emacs--process (concat (substring wire 9) "{\"type\":\"snapshot_end\"}\n"))
      (should (equal (buffer-string) "assistant\n日本語\n🌸\n\n"))
      (should (equal (process-get sync-emacs--process 'sync-emacs-input) "")))))

(ert-deftest sync-emacs-snapshot-resets-old-branch ()
  (sync-emacs-test--chat
    (sync-emacs--upsert '((id . "old") (role . "user") (text . "old branch")))
    (sync-emacs--handle '((type . "snapshot_start") (session . ((instanceId . "test") (sessionId . "new")))))
    (sync-emacs--upsert '((id . "new") (role . "assistant") (text . "new branch")))
    (sync-emacs--handle '((type . "snapshot_end")))
    (should (equal (buffer-string) "assistant\nnew branch\n\n"))
    (should (= 1 (hash-table-count sync-emacs--rows)))
    (should (equal (sync-emacs--get 'sessionId sync-emacs--session) "new"))))

(ert-deftest sync-emacs-compose-only-clears-on-successful-ack ()
  (sync-emacs-test--chat
    (let ((draft (generate-new-buffer " *pi-draft*")) sent id)
      (unwind-protect
          (progn
            (with-current-buffer draft
              (sync-emacs-compose-mode)
              (setq sync-emacs--target chat)
              (insert "draft text")
              (cl-letf (((symbol-function 'sync-emacs--wire) (lambda (_process object) (setq sent object))))
                (sync-emacs-send))
              (setq id sync-emacs--pending-id)
              (should id)
              (should (equal (buffer-string) "draft text"))
              (should-error (sync-emacs-send) :type 'user-error))
            (should (equal (sync-emacs--get 'text sent) "draft text"))
            (should (equal (sync-emacs--get 'sessionId sent) "session"))
            (should (equal (sync-emacs--get 'deliverAs sent) "followUp"))
            (sync-emacs--response `((id . ,id) (ok . t)))
            (with-current-buffer draft
              (should (equal (buffer-string) ""))
              (should-not sync-emacs--pending-id)
              (insert "keep me"))
            (puthash "bad" (cons draft "keep me") sync-emacs--pending)
            (sync-emacs--response '((id . "bad") (ok . :json-false) (error . "rejected")))
            (should (equal (with-current-buffer draft (buffer-string)) "keep me"))
            (puthash "edited" (cons draft "older version") sync-emacs--pending)
            (sync-emacs--response '((id . "edited") (ok . t)))
            (should (equal (with-current-buffer draft (buffer-string)) "keep me")))
        (kill-buffer draft)))))

(ert-deftest sync-emacs-immediate-ack-does-not-leave-draft-stuck ()
  (sync-emacs-test--chat
    (let ((draft (generate-new-buffer " *pi-fast-ack*")))
      (unwind-protect
          (with-current-buffer draft
            (sync-emacs-compose-mode)
            (setq sync-emacs--target chat)
            (insert "fast")
            (cl-letf (((symbol-function 'sync-emacs--wire)
                       (lambda (_process object)
                         (with-current-buffer chat
                           (sync-emacs--response `((id . ,(sync-emacs--get 'id object)) (ok . t)))))))
              (sync-emacs-send))
            (should-not sync-emacs--pending-id)
            (should (equal (buffer-string) "")))
        (kill-buffer draft)))))

(ert-deftest sync-emacs-disconnect-keeps-unacknowledged-drafts ()
  (sync-emacs-test--chat
    (let ((draft (generate-new-buffer " *pi-pending*")))
      (unwind-protect
          (progn
            (with-current-buffer draft
              (sync-emacs-compose-mode)
              (insert "maybe sent")
              (setq sync-emacs--pending-id "pending"))
            (puthash "pending" (cons draft "maybe sent") sync-emacs--pending)
            (delete-process sync-emacs--process)
            (sync-emacs--sentinel sync-emacs--process "closed")
            (should-not sync-emacs--ready)
            (should (= 0 (hash-table-count sync-emacs--pending)))
            (with-current-buffer draft
              (should (equal (buffer-string) "maybe sent"))
              (should-not sync-emacs--pending-id)))
        (kill-buffer draft)))))

(ert-deftest sync-emacs-associated-disconnected-target-does-not-fall-back ()
  (sync-emacs-test--chat
    (let ((sync-emacs--connections (list chat)))
      (with-temp-buffer
        (setq-local sync-emacs--target (get-buffer-create " *dead-pi*"))
        (unwind-protect
            (should-error (sync-emacs--choose-connection) :type 'user-error)
          (kill-buffer sync-emacs--target))))))

(ert-deftest sync-emacs-source-uses-unsaved-text-and-safe-fences ()
  (with-temp-buffer
    (setq buffer-file-name "/project/unsaved.md")
    (insert "first\n```some code```\nlast")
    (let ((text (sync-emacs--source-text 7 (point-max) "Explain")))
      (should (string-match-p "Explain\n\nBuffer: /project/unsaved.md (lines 2–3)" text))
      (should (string-match-p "\n````\n```some code```\nlast\n````\\'" text)))))

(ert-deftest sync-emacs-discovery-filters-stale-malformed-and-foreign-paths ()
  (let* ((directory (make-temp-file "/tmp/se-ert-" t))
         (sync-emacs-directory directory)
         (socket (expand-file-name "live.sock" directory))
         (server (make-network-process :name "se-discovery" :family 'local :server t
                                       :service socket :noquery t)))
    (unwind-protect
        (progn
          (with-temp-file (expand-file-name "live.json" directory)
            (insert (json-encode `((protocol . 1) (instanceId . "live") (sessionId . "s")
                                  (pid . ,(emacs-pid)) (socket . ,socket)))))
          (with-temp-file (expand-file-name "stale.json" directory)
            (insert (json-encode `((protocol . 1) (instanceId . "stale") (sessionId . "s")
                                  (pid . ,(emacs-pid)) (socket . "/tmp/no-such-socket")))))
          (with-temp-file (expand-file-name "malformed.json" directory) (insert "not json"))
          (should (= 1 (length (sync-emacs--sessions))))
          (set-file-modes directory #o755)
          (should-error (sync-emacs--sessions) :type 'user-error))
      (delete-process server)
      (delete-directory directory t))))

(ert-deftest sync-emacs-invalid-protocol-disconnects ()
  (sync-emacs-test--chat
    (sync-emacs--filter sync-emacs--process "{broken}\n")
    (should-not (process-live-p sync-emacs--process))
    (should (string-match-p "Protocol error" (buffer-string)))))

;;; sync-emacs-test.el ends here
