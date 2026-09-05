(ns margin.popup
  (:require [clojure.string :as str]
            [margin.async :as async]
            [margin.model :as model]
            [margin.ui :as ui]))

(defonce state (atom {:annotations [] :url nil :loaded? false}))

(defn error! [e] (ui/toast! (async/error-message e) true))
(defn library! [] (-> (async/send! {:op "library"}) (.then #(.close js/window)) (.catch error!)))

(defn render! []
  (let [{:keys [annotations url loaded?]} @state
        supported? (some? (model/canonical-url url))
        page-notes (sort-by :created-at > (model/for-page annotations url))]
    (ui/mount!
     (ui/$ "#app")
     [:div {:class "popup"}
      [:header {:class "popup-header"} (ui/brand) [:span {:class "local-badge"} [:span {}] "Just yours"]]
      [:div {:class "popup-page-info"} [:p {:class "eyebrow"} "ON THIS PAGE"]
       [:h1 {} (if supported? (model/domain url) "A little room for ideas.")]
       [:p {:class "muted"}
        (cond (not loaded?) "Opening your notebook…"
              (seq page-notes) (str (count page-notes) " saved " (if (= 1 (count page-notes)) "passage" "passages"))
              supported? "A fresh page. Make it yours."
              :else "Open a regular website to start highlighting.")]]
      (if (seq page-notes)
        [:div {:class "popup-notes"}
         (for [a (take 5 page-notes)]
           [:button {:class (str "popup-note " (:color a)) :type "button"
                     :on-click #(-> (async/send! {:op "open" :id (:id a)}) (.then (fn [] (.close js/window))) (.catch error!))}
            [:blockquote {} (:quote a)]
            (when-not (str/blank? (:note a)) [:p {} (ui/icon :note) (:note a)])
            [:span {:class "popup-note-open"} "Revisit passage" (ui/icon :arrow)]])]
        [:div {:class "popup-empty"}
         [:div {:class "popup-highlight-demo"} "Some words are " [:mark {} "worth keeping."]]
         [:p {} "Select text on a website. Pick a highlight color or add a thought. We’ll keep it here for you."]
         [:div {:class "demo-swatches" :aria-hidden "true"} (for [c model/colors] [:span {:class (str "color-dot " c)}])]
         [:p {:class "small-tip"} "Refresh tabs opened before installation. Chrome’s internal pages, store, and built-in PDF viewer aren’t supported."]])
      [:footer {:class "popup-footer"}
       (ui/button "button primary full-width" :book "Open your library" library!)
       [:span {} (str (count annotations) " highlights, kept close.  ·  Stored only on this device")]]])))

(defn init! []
  (render!)
  (-> (js/Promise.all
       #js [(async/send! {:op "list"})
            (async/chrome-call #(.query js/chrome.tabs %1 %2) #js {:active true :currentWindow true})])
      (.then (fn [results]
               (swap! state assoc :annotations (aget results 0)
                      :url (some-> (aget results 1) (aget 0) .-url) :loaded? true)
               (render!)))
      (.catch error!))
  (.addListener js/chrome.storage.onChanged
                (fn [^js changes area]
                  (when (and (= area "local") (.-annotations changes))
                    (swap! state assoc :annotations (js->clj (.. changes -annotations -newValue) :keywordize-keys true))
                    (render!)))))

(defonce initialized (init!))
