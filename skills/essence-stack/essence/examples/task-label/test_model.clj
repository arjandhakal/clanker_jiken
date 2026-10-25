#!/usr/bin/env bb
(ns task-label.model-test
  (:require [babashka.fs :as fs]
            [clojure.set :as set]
            [clojure.test :refer [deftest is run-tests]]))

(load-file (str (fs/path (fs/parent (fs/real-path *file*)) "model.clj")))
(require '[task-label.model :as m])

(deftest task-principle-and-frames
  (let [initial (-> m/empty-task (m/task-add "a") (m/task-add "b"))
        final (m/task-complete initial "a")]
    (is (= #{"a" "b"} (:live final)))
    (is (= #{"a"} (:done final)))
    (is (empty? (:done initial)))
    (is (= (:seen initial) (:seen final)))))

(deftest label-is-independent
  (let [original (-> m/empty-label (m/label-affix "opaque" "urgent") (m/label-affix "other" "urgent"))]
    (is (= #{"opaque" "other"} (m/label-find original "urgent")))
    (is (= #{"other"} (m/label-find (m/label-clear original "opaque") "urgent")))
    (is (= original (m/label-clear original "missing")))))

(deftest remove-cleanup
  (let [app (m/application)]
    (m/execute! app "1" :add "a")
    (m/execute! app "2" :affix "a" "urgent")
    (m/execute! app "3" :complete "a")
    (is (= #{"a"} (m/label-find (:label (m/snapshot app)) "urgent")))
    (is (= [[:task :remove ["a"]] [:label :clear ["a"]]] (m/execute! app "4" :remove "a")))
    (is (empty? (:live (:task (m/snapshot app)))))
    (is (empty? (m/label-find (:label (m/snapshot app)) "urgent")))))

(deftest failed-response-does-not-publish-trigger
  (let [app (m/application)]
    (m/execute! app "1" :add "a")
    (m/execute! app "2" :affix "a" "urgent")
    (let [before @app]
      (with-redefs [m/label-clear (fn [& _] (m/reject! "injected failure"))]
        (is (thrown? clojure.lang.ExceptionInfo (m/execute! app "3" :remove "a"))))
      (is (= before @app)))
    (m/execute! app "3" :remove "a")
    (is (empty? (:live (:task (m/snapshot app)))))))

(deftest rejection-is-not-an-event
  (let [app (m/application)]
    (doseq [command [[:affix "missing" "tag"] [:remove "missing"] [:add []] [:add] [:unknown "a"]]]
      (is (thrown? clojure.lang.ExceptionInfo (apply m/execute! app "r" command))))
    (is (= {:task m/empty-task :label m/empty-label} (m/snapshot app)))
    (is (empty? (m/history app)))))

(deftest duplicate-request-and-conflicting-payload
  (let [app (m/application) receipt (m/execute! app "1" :add "a")]
    (is (= receipt (m/execute! app "1" :add "a")))
    (is (= 1 (count (m/history app))))
    (is (thrown? clojure.lang.ExceptionInfo (m/execute! app "1" :add "b")))
    (is (= #{"a"} (:live (:task (m/snapshot app)))))))

(deftest removed-identity-not-reused
  (let [app (m/application)]
    (m/execute! app "1" :add "a")
    (m/execute! app "2" :remove "a")
    (doseq [command [[:add "a"] [:affix "a" "tag"]]]
      (is (thrown? clojure.lang.ExceptionInfo (apply m/execute! app "3" command))))))

(deftest projection-replay-and-bounded-interleavings
  (let [commands [[:add "a"] [:add "b"] [:complete "a"] [:affix "a" "x"] [:remove "a"] [:affix "b" "x"]]
        transitions {[:task :add] m/task-add [:task :complete] m/task-complete
                     [:task :remove] m/task-remove [:label :affix] m/label-affix [:label :clear] m/label-clear}]
    (doseq [sequence (for [a commands b commands c commands d commands] [a b c d])]
      (let [app (m/application)]
        (doseq [[index command] (map-indexed vector sequence)]
          (let [before @app]
            (try (apply m/execute! app (str index) command)
                 (catch clojure.lang.ExceptionInfo e
                   (is (= :task-label.model/rejected (:type (ex-data e))))
                   (is (= before @app)))))
          (let [{:keys [task label]} (m/snapshot app)]
            (is (set/subset? (:done task) (:live task)))
            (is (set/subset? (:live task) (:seen task)))
            (is (every? #(contains? (:live task) (first %)) label))))
        (let [replayed (reduce (fn [state [concept action args]]
                                 (update state concept #(apply (get transitions [concept action]) % args)))
                               {:task m/empty-task :label m/empty-label} (m/history app))]
          (is (= replayed (m/snapshot app))))))))

(deftest in-process-concurrent-duplicate-is-atomic
  (let [app (m/application)
        jobs (doall (repeatedly 40 #(future (m/execute! app "same" :add "a"))))
        receipts (mapv deref jobs)]
    (is (apply = receipts))
    (is (= 1 (count (m/history app))))))

(deftest missing-synchronization-counterexample
  (let [task (-> m/empty-task (m/task-add "a") (m/task-remove "a"))
        label (m/label-affix m/empty-label "a" "x")]
    (is (not (contains? (:live task) "a")))
    (is (contains? (m/label-find label "x") "a"))))

(when (= (str (fs/real-path *file*)) (some-> (System/getProperty "babashka.file") fs/real-path str))
  (let [{:keys [fail error]} (run-tests 'task-label.model-test)]
    (System/exit (if (zero? (+ fail error)) 0 1))))
