(ns margin.background
  (:require [margin.async :as async]
            [margin.model :as model]))

;; One writer, one queue: simultaneous saves from multiple tabs cannot clobber data.
(defonce write-queue (atom (js/Promise.resolve nil)))

(defn read-all [] (async/storage-get js/chrome.storage.local "annotations" []))

(defn mutate! [f]
  (let [job (-> @write-queue
                (.then read-all)
                (.then (fn [annotations]
                         (let [{:keys [annotations result]} (f annotations)]
                           (-> (async/storage-set! js/chrome.storage.local "annotations" annotations)
                               (.then (fn [] result)))))))]
    (reset! write-queue (.catch job (fn [_] nil)))
    job))

(defn deliver-focus! [tab-id]
  (let [key (str "focus-" tab-id)]
    (-> (async/storage-get js/chrome.storage.session key nil)
        (.then (fn [id]
                 (when id
                   (-> (async/chrome-call #(.sendMessage js/chrome.tabs %1 %2 %3)
                                          tab-id (clj->js {:type "focus" :id id}))
                       (.catch (fn [_] nil)))))))))

(defn open-annotation! [id]
  (-> (read-all)
      (.then (fn [annotations]
               (if-let [a (first (filter #(= id (:id %)) annotations))]
                 (-> (async/chrome-call #(.create js/chrome.tabs %1 %2) #js {:url (:url a)})
                     (.then (fn [tab]
                              (-> (async/storage-set! js/chrome.storage.session (str "focus-" (.-id tab)) id)
                                  (.then #(deliver-focus! (.-id tab)))))))
                 (throw (js/Error. "This highlight no longer exists.")))))))

(defn handle! [{:keys [op annotation id patch backup]} ^js sender]
  (case op
    "list" (read-all)
    "create"
    (mutate!
     (fn [annotations]
       (let [now (.now js/Date)
             a (-> annotation
                   (assoc :id (str (random-uuid)) :created-at now :updated-at now)
                   model/clean-annotation)]
         (when-not (model/valid-annotation? a)
           (throw (js/Error. "That selection could not be saved. Select up to 20,000 characters and try again.")))
         {:annotations (conj (vec annotations) a) :result a})))
    "update"
    (mutate!
     (fn [annotations]
       (let [original (first (filter #(= id (:id %)) annotations))
             a (merge original (select-keys patch [:note :color]) {:updated-at (.now js/Date)})]
         (when-not (and original (model/valid-annotation? a))
           (throw (js/Error. "This note could not be saved. It may have been deleted in another tab.")))
         {:annotations (mapv #(if (= id (:id %)) a %) annotations) :result a})))
    "delete"
    (mutate! (fn [annotations] {:annotations (filterv #(not= id (:id %)) annotations) :result id}))
    "import"
    (mutate! (fn [annotations]
               (let [result (model/import-annotations annotations backup)]
                 {:annotations (:annotations result) :result (:added result)})))
    "open" (open-annotation! id)
    "library" (async/chrome-call #(.create js/chrome.tabs %1 %2)
                                #js {:url (.getURL js/chrome.runtime "library.html")})
    "page-ready"
    (-> (read-all)
        (.then (fn [annotations]
                 (-> (async/storage-get js/chrome.storage.session (str "focus-" (.. sender -tab -id)) nil)
                     (.then (fn [focus-id] {:annotations annotations :focus-id focus-id}))))))
    "focus-consumed"
    (async/chrome-call #(.remove js/chrome.storage.session %1 %2) (str "focus-" (.. sender -tab -id)))
    (js/Promise.reject (js/Error. "Unknown Margin request."))))

(.addListener js/chrome.runtime.onMessage
              (fn [raw sender respond]
                (when (= (.-id sender) (.-id js/chrome.runtime))
                  (-> (js/Promise.resolve nil)
                      (.then #(handle! (js->clj raw :keywordize-keys true) sender))
                      (.then #(respond (clj->js {:ok true :data %})))
                      (.catch #(respond (clj->js {:ok false :error (async/error-message %)}))))
                  true)))

(.addListener js/chrome.tabs.onUpdated
              (fn [tab-id info _]
                (when (= "complete" (.-status info))
                  (-> (deliver-focus! tab-id) (.catch (fn [_] nil))))))

(.addListener js/chrome.tabs.onRemoved
              (fn [tab-id _]
                (.remove js/chrome.storage.session (str "focus-" tab-id))))
