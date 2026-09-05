(ns margin.library
  (:require [clojure.string :as str]
            [margin.async :as async]
            [margin.model :as model]
            [margin.ui :as ui]))

(defonce state (atom {:annotations [] :query "" :view :all :color nil :layout :grid :loaded? false}))
(defonce editor-state (atom nil))
(declare render! render-results! close-editor! open-editor!)

(defn error! [error] (ui/toast! (async/error-message error) true))
(defn open-source! [a] (-> (async/send! {:op "open" :id (:id a)}) (.catch error!)))

(defn close-editor! []
  (when (or (not (:dirty? @editor-state)) (js/confirm "Discard your unsaved changes?"))
    (let [return-id (:id @editor-state)]
      (reset! editor-state nil)
      (when-let [dialog (ui/$ "#note-dialog")] (.close dialog) (.remove dialog))
      (when-let [button (first (filter #(= return-id (.getAttribute % "data-edit-id"))
                                      (array-seq (.querySelectorAll js/document "[data-edit-id]"))))]
        (.focus button))
      true)))

(defn open-editor! [a]
  (when (or (nil? @editor-state) (close-editor!))
    (reset! editor-state {:id (:id a) :color (:color a) :dirty? false})
    (let [dialog
          (ui/node
           [:dialog {:id "note-dialog" :class "note-dialog" :aria-labelledby "dialog-title"
                     :on-cancel (fn [e] (.preventDefault e) (close-editor!))
                     :on-click #(when (= (.-target %) (ui/$ "#note-dialog")) (close-editor!))}
            [:div {:class "dialog-inner"}
             [:header {:class "dialog-header"}
              [:div {} [:p {:class "eyebrow"} "A SPACE FOR YOUR THOUGHTS"] [:h2 {:id "dialog-title"} "In the margin"]]
              (ui/icon-button :close "Close editor" close-editor!)]
             (ui/source a)
             [:blockquote {:class (str "editor-quote " (:color a))} (:quote a)]
             [:label {:class "field-label" :for "edit-note"} "Your note"]
             [:textarea {:id "edit-note" :class "note-input" :value (:note a)
                         :placeholder "Connect an idea. Ask a question. Make it yours."
                         :maxlength model/max-note-length :on-input #(swap! editor-state assoc :dirty? true)}]
             [:div {:class "editor-meta"} [:div {:id "edit-palette"}]
              [:span {:class "muted"} "⌘ / Ctrl + Enter to save"]]
             [:p {:id "save-error" :class "error-text" :role "alert"}]
             [:footer {:class "dialog-footer"}
              (ui/button "button ghost danger" :trash "Delete"
                         #(when (js/confirm "Permanently delete this highlight and its note?")
                            (-> (async/send! {:op "delete" :id (:id a)})
                                (.then (fn [] (swap! editor-state assoc :dirty? false) (close-editor!) (ui/toast! "Highlight deleted.")))
                                (.catch error!))))
              [:div {:class "button-row"}
               (ui/button "button secondary" :arrow "Visit page" #(open-source! a))
               [:button {:id "save-edit" :class "button primary" :type "button"
                         :on-click
                         (fn [_]
                           (let [button (ui/$ "#save-edit")]
                             (set! (.-disabled button) true)
                             (-> (async/send! {:op "update" :id (:id a)
                                              :patch {:note (.-value (ui/$ "#edit-note")) :color (:color @editor-state)}})
                                 (.then (fn [] (swap! editor-state assoc :dirty? false) (close-editor!) (ui/toast! "Note saved. Thought kept.")))
                                 (.catch (fn [e]
                                           (set! (.-disabled button) false)
                                           (when-let [el (ui/$ "#save-error")] (set! (.-textContent el) (async/error-message e))))))))}
                (ui/icon :check) "Save note"]]]]])]
      (.appendChild (.-body js/document) dialog)
      (letfn [(palette! []
                (ui/mount! (ui/$ "#edit-palette")
                           (ui/palette (:color @editor-state)
                                       #(do (swap! editor-state assoc :color % :dirty? true) (palette!)))))]
        (palette!))
      (.addEventListener dialog "keydown"
                         (fn [e]
                           (when (and (= "Enter" (.-key e)) (or (.-metaKey e) (.-ctrlKey e)))
                             (.preventDefault e) (.click (ui/$ "#save-edit")))))
      (.showModal dialog)
      (.focus (ui/$ "#edit-note")))))

(defn export! [format]
  (when-let [menu (ui/$ ".export-menu")] (set! (.-open menu) false))
  (let [annotations (:annotations @state)
        day (subs (.toISOString (js/Date.)) 0 10)]
    (if (= format :json)
      (ui/download! (str "margin-backup-" day ".json")
                    (js/JSON.stringify (clj->js {:version 1 :exported-at (.now js/Date) :annotations annotations}) nil 2)
                    "application/json")
      (ui/download! (str "margin-notes-" day ".md") (model/markdown annotations) "text/markdown"))
    (ui/toast! "Your library is ready to download.")))

(defn import-file! [event]
  (let [input (.-target event) file (aget (.-files input) 0)]
    (when file
      (if (> (.-size file) (* 20 1024 1024))
        (ui/toast! "That file is too large. Backups must be smaller than 20 MB." true)
        (-> (.text file)
            (.then (fn [text]
                     (let [backup (js->clj (js/JSON.parse text) :keywordize-keys true)]
                       ;; Validate before asking the worker to commit, with no partial imports.
                       (model/import-annotations (:annotations @state) backup)
                       (async/send! {:op "import" :backup backup}))))
            (.then #(ui/toast! (str "Imported " % " highlights. Existing notes were kept.")))
            (.catch error!)))
      (set! (.-value input) ""))))

(defn card [a]
  [:article {:class (str "note-card " (:color a))}
   (ui/source a)
   [:button {:class "quote-button" :type "button" :data-edit-id (:id a) :on-click #(open-editor! a)
             :aria-label (str "Edit highlight from " (:title a))}
    [:blockquote {} [:span {:class "quote-highlight"} (:quote a)]]]
   (if (str/blank? (:note a))
     [:button {:type "button" :class "add-note" :on-click #(open-editor! a)} (ui/icon :note) "Add a thought…"]
     [:p {:class "card-note"} (:note a)])
   [:footer {:class "card-footer"}
    [:span {:class "card-date"} [:span {:class (str "color-dot " (:color a))}] (ui/date-label (:created-at a))]
    [:div {:class "card-actions"}
     (ui/icon-button :note "Edit note" #(open-editor! a))
     (ui/icon-button :arrow "Open original passage" #(open-source! a))]]])

(defn empty-library []
  [:div {:class "welcome"}
   [:div {:class "welcome-art" :aria-hidden "true"}
    [:div {:class "paper-back"}]
    [:div {:class "paper-front"} [:span {:class "paper-label"} "THE GOOD PARTS"]
     [:div {:class "paper-line long"}] [:div {:class "paper-line marked"} "An idea worth coming back to."]
     [:div {:class "paper-line"}] [:div {:class "paper-line short"}]
     [:div {:class "paper-scribble"} "keep this thought ↗"]]
    [:span {:class "art-spark"} "✳"]]
   [:p {:class "eyebrow"} "READ. HIGHLIGHT. MAKE IT YOURS."]
   [:h2 {} "Leave yourself a little margin."]
   [:p {:class "welcome-description"} "For the sentences that stop you scrolling, and the ideas you don’t want to lose. Your collection starts with a highlight."]
   [:div {:class "onboarding-steps"}
    [:div {} [:span {:class "step-number"} "01"] [:strong {} "Find something good"] [:p {} "Open any article or website you love."]]
    [:div {} [:span {:class "step-number"} "02"] [:strong {} "Select a passage"] [:p {} "Pick a color, or add a note in the toolbar."]]
    [:div {} [:span {:class "step-number"} "03"] [:strong {} "Come back to it"] [:p {} "Your highlights and thoughts live right here."]]]
   [:p {:class "welcome-tip"} "Already have a page open? Refresh it once after installing Margin."]])

(defn render-results! []
  (let [{:keys [annotations query view color layout loaded?]} @state
        results (model/search annotations query view color)]
    (when-let [el (ui/$ "#results-count")]
      (set! (.-textContent el) (str (count results) " " (if (= 1 (count results)) "highlight" "highlights"))))
    (when-let [el (ui/$ "#results")]
      (ui/mount! el
                 (cond
                   (not loaded?) [:div {:class "empty-search" :role "status"} "Opening your library…"]
                   (empty? annotations) (empty-library)
                   (empty? results) [:div {:class "empty-search"} (ui/icon :search) [:h2 {} "Nothing here just yet."]
                                     [:p {} "Try a different search or clear your filters."]
                                     (ui/button "button secondary" nil "Clear filters"
                                                #(do (swap! state assoc :query "" :view :all :color nil) (render!)))]
                   :else [:div {:class (str "cards " (name layout))} (map card results)])))
    (when-let [el (ui/$ "#all-count")] (set! (.-textContent el) (count annotations)))
    (when-let [el (ui/$ "#notes-count")]
      (set! (.-textContent el) (count (remove #(str/blank? (:note %)) annotations))))
    (when-let [el (ui/$ "#website-count")]
      (set! (.-textContent el) (count (set (map #(model/domain (:url %)) annotations)))))))

(defn set-filter! [key value] (swap! state assoc key value) (render!))

(defn render! []
  (let [{:keys [query view color layout]} @state]
    (ui/mount!
     (ui/$ "#app")
     [:div {:class "app-shell"}
      [:aside {:class "sidebar"}
       (ui/brand)
       [:div {:class "sidebar-section"} [:p {:class "eyebrow"} "YOUR COLLECTION"]
        [:nav {:aria-label "Library views"}
         [:button {:class (str "nav-item" (when (= view :all) " active")) :on-click #(set-filter! :view :all)}
          (ui/icon :book) "All highlights" [:span {:id "all-count" :class "nav-count"} "0"]]
         [:button {:class (str "nav-item" (when (= view :notes) " active")) :on-click #(set-filter! :view :notes)}
          (ui/icon :note) "With notes" [:span {:id "notes-count" :class "nav-count"} "0"]]]]
       [:div {:class "sidebar-section colors-section"} [:p {:class "eyebrow"} "A LITTLE COLOR"]
        (for [c model/colors]
          [:button {:class (str "color-filter" (when (= c color) " active")) :aria-pressed (= c color)
                    :on-click #(set-filter! :color (when (not= c color) c))}
           [:span {:class (str "color-dot " c)}] (get model/color-labels c) (when (= c color) (ui/icon :check))])]
       [:div {:class "sidebar-bottom"}
        [:div {:class "privacy-note"} (ui/icon :lock) [:div {} [:strong {} "Just yours."] [:p {} "Saved on this device.\nNo accounts. No tracking."]]]
        [:div {:class "backup-actions"}
         (ui/button "text-button" :upload "Import backup" #(.click (ui/$ "#import-file")))
         [:input {:id "import-file" :type "file" :accept ".json,application/json" :hidden "hidden" :on-change import-file!}]]
        [:span {:class "version"} "MARGIN / v0.1.0"]]]
      [:main {:class "main"}
       [:header {:class "topbar"}
        [:div {:class "breadcrumb"} "Your reading space" [:span {} "/"] [:strong {} "Library"]]
        [:div {:class "topbar-right"} [:span {:class "local-badge"} [:span {}] "Local & private"]
         [:details {:class "export-menu"}
          [:summary {:class "button secondary"} (ui/icon :download) "Export"]
          [:div {:class "menu-items"}
           (ui/button "menu-item" nil "JSON backup" #(export! :json))
           (ui/button "menu-item" nil "Markdown notes" #(export! :markdown))]]]]
       [:section {:class "library-heading"}
        [:p {:class "eyebrow"} "LESS LOST. MORE REMEMBERED."]
        [:div {:class "heading-row"} [:h1 {} "Your internet, " [:em {} "annotated."]]
         [:span {:class "heading-flower" :aria-hidden "true"} "✳"]]
        [:p {:class "heading-description"} "The good parts of what you read. The thoughts you made your own."]]
       [:section {:class "collection" :aria-label "Saved highlights"}
        [:div {:class "collection-controls"}
         [:div {:class "collection-title"} [:h2 {} (if (= view :notes) "Thoughts & highlights" "All highlights")]
          [:span {:id "results-count" :class "count-pill"} "0 highlights"]]
         [:div {:class "search-and-view"}
          [:div {:class "search-field"} (ui/icon :search)
           [:input {:type "search" :id "search" :placeholder "Search your highlights…" :aria-label "Search highlights"
                    :value query :on-input #(do (swap! state assoc :query (.. % -target -value)) (render-results!))}]
           [:kbd {} "/"]]
          [:div {:class "view-toggle" :role "group" :aria-label "Layout"}
           [:button {:class (when (= layout :grid) "active") :title "Grid view" :aria-label "Grid view"
                     :aria-pressed (= layout :grid) :on-click #(set-filter! :layout :grid)} (ui/icon :grid)]
           [:button {:class (when (= layout :list) "active") :title "List view" :aria-label "List view"
                     :aria-pressed (= layout :list) :on-click #(set-filter! :layout :list)} (ui/icon :list)]]]]
        (when color [:div {:class "active-filter"} [:span {:class (str "color-dot " color)}] (get model/color-labels color)
                     (ui/icon-button :close "Clear color filter" #(set-filter! :color nil))])
        [:div {:id "results"}]]
       [:footer {:class "library-footer"} [:span {} "A small home for big ideas."]
        [:span {} [:strong {:id "website-count"} "0"] " websites in your collection"]]]]))
  (render-results!))

(defn init! []
  (render!)
  (-> (async/send! {:op "list"})
      (.then #(do (swap! state assoc :annotations % :loaded? true) (render-results!)))
      (.catch (fn [e] (error! e) (when-let [el (ui/$ "#results")]
                                 (ui/mount! el [:div {:class "empty-search" :role "alert"}
                                                [:h2 {} "Couldn’t open your library"]
                                                [:p {} (async/error-message e)]
                                                (ui/button "button secondary" nil "Try again" #(.reload js/location))])))))
  (.addListener js/chrome.storage.onChanged
                (fn [^js changes area]
                  (when (and (= area "local") (.-annotations changes))
                    (swap! state assoc :annotations (js->clj (.. changes -annotations -newValue) :keywordize-keys true))
                    (render-results!))))
  (.addEventListener js/window "beforeunload"
                     (fn [e] (when (:dirty? @editor-state) (.preventDefault e) (set! (.-returnValue e) ""))))
  (.addEventListener js/document "keydown"
                     (fn [e]
                       (when (and (= "/" (.-key e)) (nil? @editor-state)
                                  (not (contains? #{"INPUT" "TEXTAREA"} (.. e -target -tagName))))
                         (.preventDefault e) (.focus (ui/$ "#search"))))))

(defonce initialized (init!))
