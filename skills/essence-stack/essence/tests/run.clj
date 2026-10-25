#!/usr/bin/env bb
(require '[babashka.fs :as fs] '[clojure.test :as test])
(let [skill (-> *file* fs/real-path fs/parent fs/parent)]
  (load-file (str (fs/path skill "tests/test_tools.clj")))
  (load-file (str (fs/path skill "examples/task-label/test_model.clj"))))
(let [{:keys [fail error]} (test/run-tests 'essence.tools-test 'task-label.model-test)]
  (System/exit (if (zero? (+ fail error)) 0 1)))
