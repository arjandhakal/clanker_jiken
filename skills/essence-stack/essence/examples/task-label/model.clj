(ns task-label.model
  "Independent pure transitions with atomic in-process composition."
  (:require [clojure.string :as str]))

(def empty-task {:live #{} :done #{} :seen #{}})
(def empty-label #{})

(defn reject! [message] (throw (ex-info message {:type ::rejected})))

(defn task-add [task item]
  (when (contains? (:seen task) item) (reject! "identity must be fresh"))
  (-> task (update :live conj item) (update :seen conj item)))

(defn task-complete [task item]
  (when-not (contains? (:live task) item) (reject! "task must exist"))
  (update task :done conj item))

(defn task-remove [task item]
  (when-not (contains? (:live task) item) (reject! "task must exist"))
  (-> task (update :live disj item) (update :done disj item)))

(defn label-affix [pairs item label] (conj pairs [item label]))
(defn label-clear [pairs item] (into #{} (remove #(= item (first %))) pairs))
(defn label-find [pairs label] (into #{} (comp (filter #(= label (second %))) (map first)) pairs))

(defn application []
  (atom {:task empty-task :label empty-label :history [] :receipts {}}))

(defn snapshot [app] (select-keys @app [:task :label]))
(defn history [app] (:history @app))

(defn transition
  "Pure composition; safe for swap! to evaluate more than once on contention.
  Never perform external effects or mutate concept state inside this function."
  [state request-id command args]
  (let [payload [command args]]
    (if-let [receipt (get-in state [:receipts request-id])]
      (if (= payload (:payload receipt))
        state
        (reject! "request id reused with different payload"))
      (let [{:keys [task label]} state
            item (first args)
            [next-task next-label events]
            (case command
              :add [(task-add task item) label [[:task :add args]]]
              :complete [(task-complete task item) label [[:task :complete args]]]
              :remove [(task-remove task item) (label-clear label item)
                       [[:task :remove args] [:label :clear args]]]
              :affix (do
                       ;; Application lifetime policy, not a dependency inside Label.
                       (when-not (contains? (:live task) item)
                         (reject! "cannot label a nonexistent task"))
                       [task (apply label-affix label args) [[:label :affix args]]]))]
        ;; A failed target transition throws before any aggregate state is published.
        (-> state
            (assoc :task next-task :label next-label)
            (update :history into events)
            (assoc-in [:receipts request-id] {:payload payload :events events}))))))

(defn execute! [app request-id command & args]
  (when-not (and (string? request-id) (not (str/blank? request-id)))
    (reject! "request id must be a nonempty string"))
  (when-not (= (get {:add 1 :complete 1 :remove 1 :affix 2} command) (count args))
    (reject! "unknown command or wrong argument count"))
  (when-not (every? #(and (string? %) (not (str/blank? %))) args)
    (reject! "arguments must be nonempty immutable strings"))
  (let [committed (swap! app transition request-id command (vec args))]
    (get-in committed [:receipts request-id :events])))
