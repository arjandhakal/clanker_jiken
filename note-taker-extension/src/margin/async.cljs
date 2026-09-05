(ns margin.async)

(defn chrome-call [f & args]
  (js/Promise.
   (fn [resolve reject]
     (apply f (concat args
                      [(fn [result]
                         (if-let [error (.-lastError js/chrome.runtime)]
                           (reject (js/Error. (.-message error)))
                           (resolve result)))])))))

(defn send! [message]
  (-> (chrome-call #(.sendMessage js/chrome.runtime %1 %2) (clj->js message))
      (.then (fn [response]
               (let [data (js->clj response :keywordize-keys true)]
                 (if (:ok data)
                   (:data data)
                   (throw (js/Error. (or (:error data) "Margin could not connect. Reload this page and try again.")))))))))

(defn storage-get [area key default]
  (-> (chrome-call #(.get area %1 %2) key)
      (.then #(get (js->clj % :keywordize-keys true) (keyword key) default))))

(defn storage-set! [area key value]
  (chrome-call #(.set area %1 %2) (clj->js {key value})))

(defn error-message [error]
  (or (.-message error) "Something went wrong. Please try again."))
