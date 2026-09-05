(ns margin.ui
  (:require [clojure.string :as str]
            [margin.model :as model]))

(def icon-paths
  {:arrow "M7 17 17 7M7 7h10v10"
   :book "M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4V4Zm9 3a3 3 0 0 1 3-3h5v15h-4a4 4 0 0 0-4 2"
   :search "m21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0"
   :note "M8 3H4v18h16V9M8 8h4M8 13h8M8 17h5m1-11 4-4 4 4-8 8h-4v-4l4-4Z"
   :close "m6 6 12 12M6 18 18 6"
   :download "M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"
   :upload "M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"
   :trash "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"
   :check "m5 12 4 4L19 6"
   :spark "m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z"
   :globe "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"
   :grid "M3 3h7v7H3V3Zm11 0h7v7h-7V3ZM3 14h7v7H3v-7Zm11 0h7v7h-7v-7Z"
   :list "M8 5h13M8 12h13M8 19h13M3 5h1M3 12h1M3 19h1"
   :highlight "m14 3 7 7-9 9H5v-7l9-9ZM3 21h12M7 10l7 7"
   :lock "M5 10h14v11H5V10Zm3 0V7a4 4 0 0 1 8 0v3M12 14v3"})

(defn icon [name]
  [:svg {:viewBox "0 0 24 24" :fill "none" :stroke "currentColor"
         :stroke-width "1.65" :stroke-linecap "round" :stroke-linejoin "round"
         :aria-hidden "true" :class "icon"}
   [:path {:d (get icon-paths name (:note icon-paths))}]])

(declare node)

(defn element [tag attrs children]
  (let [svg? (contains? #{:svg :path :circle :rect} tag)
        el (if svg? (.createElementNS js/document "http://www.w3.org/2000/svg" (name tag))
               (.createElement js/document (name tag)))]
    (doseq [[k v] attrs]
      (let [attr (name k)]
        (cond
          (nil? v) nil
          (str/starts-with? attr "on-") (.addEventListener el (subs attr 3) v)
          (= k :value) (set! (.-value el) v)
          (= k :checked) (set! (.-checked el) (boolean v))
          (= k :disabled) (set! (.-disabled el) (boolean v))
          (= k :style) (set! (.. el -style -cssText) v)
          :else (.setAttribute el attr (str v)))))
    (doseq [child children] (when-let [n (node child)] (.appendChild el n)))
    el))

(defn node [form]
  (cond
    (nil? form) nil
    (false? form) nil
    (vector? form) (let [[tag & body] form
                         [attrs children] (if (map? (first body)) [(first body) (rest body)] [{} body])]
                     (element tag attrs children))
    (seq? form) (let [fragment (.createDocumentFragment js/document)]
                  (doseq [child form] (when-let [n (node child)] (.appendChild fragment n))) fragment)
    :else (.createTextNode js/document (str form))))

(defn mount! [el form]
  (.replaceChildren el)
  (when-let [n (node form)] (.appendChild el n)))

(defn $ [selector] (.querySelector js/document selector))

(defn brand []
  [:div {:class "brand"} [:span {:class "brand-mark"} "m"] [:span {} "margin" [:span {:class "brand-dot"} "."]]])

(defn button [class icon-name label on-click]
  [:button {:type "button" :class class :on-click on-click} (when icon-name (icon icon-name)) label])

(defn icon-button [icon-name label on-click]
  [:button {:type "button" :class "icon-button" :title label :aria-label label :on-click on-click} (icon icon-name)])

(defn palette [selected on-change]
  [:div {:class "palette" :role "group" :aria-label "Highlight color"}
   (for [color model/colors]
     [:button {:type "button" :class (str "swatch " color (when (= color selected) " selected"))
               :title (get model/color-labels color) :aria-label (get model/color-labels color)
               :aria-pressed (= color selected) :on-click #(on-change color)}
      (when (= color selected) (icon :check))])])

(defn date-label [timestamp]
  (.toLocaleDateString (js/Date. timestamp) "en" #js {:month "short" :day "numeric" :year "numeric"}))

(defn source [annotation]
  [:div {:class "source"}
   [:span {:class "site-avatar"} (str/upper-case (subs (model/domain (:url annotation)) 0 1))]
   [:span {:class "source-text"} [:strong {} (model/domain (:url annotation))]
    [:span {:class "source-title" :title (:title annotation)} (:title annotation)]]])

(defonce toast-timer (atom nil))
(defn toast! [message & [error?]]
  (when-let [existing ($ "#toast")] (.remove existing))
  (js/clearTimeout @toast-timer)
  (let [el (node [:div {:id "toast" :class (str "toast" (when error? " error")) :role "status"} message])]
    (.appendChild (.-body js/document) el)
    (reset! toast-timer (js/setTimeout #(.remove el) 4500))))

(defn download! [filename content mime]
  (let [url (.createObjectURL js/URL (js/Blob. #js [content] #js {:type mime}))
        a (.createElement js/document "a")]
    (set! (.-href a) url)
    (set! (.-download a) filename)
    (.click a)
    (js/setTimeout #(.revokeObjectURL js/URL url) 1000)))
