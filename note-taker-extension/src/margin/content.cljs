(ns margin.content
  (:require [clojure.string :as str]
            [margin.anchor :as anchor]
            [margin.async :as async]
            [margin.model :as model]
            [margin.ui :as ui]))

(defonce state (atom {:annotations [] :ranges {} :url (.-href js/location) :selection nil :focus-id nil}))
(defonce host (.createElement js/document "div"))
(defonce shadow (.attachShadow host #js {:mode "open"}))
(defonce debounce-timer (atom nil))
(defonce message-timer (atom nil))
(defonce focus-timer (atom nil))

(def styles
  ":host{all:initial!important;color-scheme:light!important}*{box-sizing:border-box}button,textarea{font:inherit}button{cursor:pointer}button:focus-visible,textarea:focus-visible{outline:3px solid #74885b;outline-offset:3px}.surface{position:fixed;z-index:2147483647;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#292d25;background:#fffef9;border:1px solid #e4e4d7;box-shadow:0 10px 45px #1f291b24;border-radius:14px}.toolbar{display:flex;align-items:center;gap:10px;padding:9px 12px}.mini-brand{font:bold italic 24px Georgia,serif;color:#566641;padding-right:10px;border-right:1px solid #e0e2d7}.palette{display:flex;gap:6px}.swatch{height:27px;width:27px;border:1px solid #00000012;border-radius:50%;display:grid;place-items:center;padding:5px;color:#30372b}.swatch:hover{transform:scale(1.12)}.swatch.selected{outline:2px solid #566641;outline-offset:2px}.yellow{background:#f4da85}.green{background:#bed6ae}.blue{background:#b8d6ec}.pink{background:#eec3cb}.icon{width:17px;height:17px;flex-shrink:0}.button{border:0;border-radius:8px;background:#edf0e5;color:#34452b;padding:7px 10px;display:inline-flex;gap:6px;align-items:center;font-weight:600}.button.primary{background:#526442;color:#fff}.button:hover{filter:brightness(.96)}.button:disabled{opacity:.55;cursor:wait}.icon-button{display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:#73786d;border-radius:7px;padding:6px}.icon-button:hover{background:#efefe5}.panel{right:22px;top:24px;width:340px;max-width:calc(100vw - 24px);max-height:calc(100vh - 48px);overflow:auto;padding:21px}.panel header{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.panel h2{font:600 16px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0}.panel blockquote{margin:0 0 18px;padding:12px 14px;border-left:3px solid #cfb658;background:#f8f5e9;font:17px/1.55 Georgia,serif;max-height:180px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere}.panel label{display:block;font-weight:600;font-size:12px;margin-bottom:7px}.panel textarea{display:block;background:#fffef9;color:#292d25;border:1px solid #d9dccf;border-radius:8px;padding:11px;resize:vertical;width:100%;min-height:130px;line-height:1.6;margin-bottom:15px}.panel .actions{display:flex;align-items:center;justify-content:space-between;margin-top:20px}.muted{color:#777c70;font-size:12px}.error-text{color:#a13e39;font-size:12px;margin-top:10px}.message{bottom:26px;left:50%;transform:translateX(-50%);padding:12px 19px;max-width:calc(100vw - 32px)}")

(defn shadow-el [id] (.getElementById shadow id))
(defn remove-ui! [id] (when-let [el (shadow-el id)] (.remove el)))

(defn message! [text]
  (remove-ui! "message")
  (js/clearTimeout @message-timer)
  (.appendChild shadow (ui/node [:div {:id "message" :class "surface message" :role "status"} text]))
  (reset! message-timer (js/setTimeout #(remove-ui! "message") 4500)))

(defn eligible? [node]
  (let [parent (.-parentElement node)]
    (and parent (not (str/blank? (.-nodeValue node)))
         (not (.closest parent "script,style,noscript,textarea,input,select,option,[contenteditable]:not([contenteditable='false']),[hidden],[aria-hidden='true'],#margin-extension-root"))
         ;; Layout visibility, unlike offsetParent, includes fixed-position text.
         (pos? (.-length (.getClientRects parent))))))

(defn text-index []
  (let [walker (.createTreeWalker js/document (.-body js/document) js/NodeFilter.SHOW_TEXT)]
    (loop [node (.nextNode walker) offset 0 entries [] texts []]
      (if node
        ;; Keep whitespace-only nodes between visible elements, too.
        (let [parent (.-parentElement node)
              keep? (or (eligible? node)
                        (and parent (str/blank? (.-nodeValue node))
                             (not (.closest parent "script,style,noscript,textarea,select,[hidden],[aria-hidden='true'],[contenteditable]:not([contenteditable='false']),#margin-extension-root"))
                             (pos? (.-length (.getClientRects parent)))))]
          (if keep?
            (let [text (.-nodeValue node) end (+ offset (count text))]
              (recur (.nextNode walker) end (conj entries {:node node :start offset :end end}) (conj texts text)))
            (recur (.nextNode walker) offset entries texts)))
        {:text (apply str texts) :entries entries}))))

(defn range-for [{:keys [entries]} start end]
  (let [a (first (filter #(and (<= (:start %) start) (< start (:end %))) entries))
        b (first (filter #(and (< (:start %) end) (<= end (:end %))) entries))]
    (when (and a b)
      (let [range (.createRange js/document)]
        (.setStart range (:node a) (- start (:start a)))
        (.setEnd range (:node b) (- end (:start b)))
        range))))

(defn capture-selection []
  (let [selection (.getSelection js/window)]
    (when (and (pos? (.-rangeCount selection)) (not (.-isCollapsed selection)))
      (let [range (.getRangeAt selection 0)
            parent (if (= js/Node.ELEMENT_NODE (.. range -commonAncestorContainer -nodeType))
                     (.-commonAncestorContainer range) (.. range -commonAncestorContainer -parentElement))]
        (when (and parent (not (.closest parent "input,textarea,[contenteditable]:not([contenteditable='false']),#margin-extension-root")))
          (let [index (text-index)
                entries (filter #(try (.intersectsNode range (:node %)) (catch :default _ false)) (:entries index))
                first-entry (first entries) last-entry (last entries)]
            (when (and first-entry last-entry)
              (let [start (+ (:start first-entry) (if (= (:node first-entry) (.-startContainer range)) (.-startOffset range) 0))
                    end (+ (:start last-entry) (if (= (:node last-entry) (.-endContainer range)) (.-endOffset range)
                                                  (count (.-nodeValue (:node last-entry)))))]
                (when (and (< start end) (<= (- end start) model/max-quote-length))
                  {:selector (anchor/selector (:text index) start end)
                   :rect (.getBoundingClientRect range)})))))))))

(declare repaint! show-editor! focus! schedule-paint!)

(defn persist! [a patch]
  (if (:id a)
    (async/send! {:op "update" :id (:id a) :patch patch})
    (async/send! {:op "create" :annotation (merge a patch)})))

(defn new-annotation []
  (merge (get-in @state [:selection :selector])
         {:url (.-href js/location) :title (subs (.-title js/document) 0 (min 2000 (count (.-title js/document))))
          :note "" :color "yellow"}))

(defn accept-saved! [a]
  (swap! state update :annotations #(conj (filterv (fn [old] (not= (:id old) (:id a))) %) a))
  (repaint!)
  (.removeAllRanges (.getSelection js/window))
  (remove-ui! "toolbar"))

(defn quick-save! [color]
  (let [a (new-annotation)]
    (remove-ui! "toolbar")
    (-> (persist! a {:color color :note ""})
        (.then (fn [saved] (accept-saved! saved) (message! "Highlight saved to your library.")))
        (.catch #(message! (async/error-message %))))))

(defn close-editor! []
  (when-let [panel (shadow-el "editor")]
    (if (or (not (.-marginDirty panel)) (js/confirm "Discard your unsaved note?"))
      (do (remove-ui! "editor") true)
      false)))

(defn show-editor! [a]
  (when (or (nil? (shadow-el "editor")) (close-editor!))
    (remove-ui! "toolbar")
    (let [color (atom (:color a))
          panel (ui/node
                 [:section {:id "editor" :class "surface panel" :role "dialog" :aria-label "Highlight note"}
                  [:header {} [:h2 {} (if (:id a) "In the margin" "A thought worth keeping")]
                   (ui/icon-button :close "Close note" close-editor!)]
                  [:blockquote {} (:quote a)]
                  [:label {:for "margin-note"} "YOUR NOTE"]
                  [:textarea {:id "margin-note" :placeholder "What does this make you think of?" :value (:note a)
                              :maxlength model/max-note-length
                              :on-input #(set! (.-marginDirty (shadow-el "editor")) true)}]
                  [:div {:id "editor-palette"}]
                  [:div {:id "editor-error" :class "error-text" :role "alert"}]
                  [:div {:class "actions"}
                   (if (:id a)
                     (ui/icon-button :trash "Delete highlight"
                                     #(when (js/confirm "Delete this highlight and its note?")
                                        (-> (async/send! {:op "delete" :id (:id a)})
                                            (.then (fn []
                                                     (swap! state update :annotations (fn [xs] (filterv (fn [x] (not= (:id x) (:id a))) xs)))
                                                     (remove-ui! "editor") (repaint!) (message! "Highlight deleted.")))
                                            (.catch (fn [e] (message! (async/error-message e)))))))
                     [:span {:class "muted"} "Only on this device"])
                   [:button {:id "save-note" :type "button" :class "button primary"
                             :on-click
                             (fn [_]
                               (let [button (shadow-el "save-note")]
                                 (set! (.-disabled button) true)
                                 (-> (persist! a {:note (.-value (shadow-el "margin-note")) :color @color})
                                     (.then (fn [saved] (accept-saved! saved) (remove-ui! "editor") (message! "Note saved. Thought kept.")))
                                     (.catch (fn [e]
                                               (set! (.-disabled button) false)
                                               (when-let [error-el (shadow-el "editor-error")]
                                                 (set! (.-textContent error-el) (async/error-message e))))))))}
                    (ui/icon :check) "Save note"]]])]
      (.appendChild shadow panel)
      (letfn [(paint-palette []
                (ui/mount! (shadow-el "editor-palette")
                           (ui/palette @color #(do (reset! color %) (set! (.-marginDirty panel) true) (paint-palette)))))]
        (paint-palette))
      (.addEventListener panel "keydown"
                         (fn [event]
                           (when (and (or (.-metaKey event) (.-ctrlKey event)) (= "Enter" (.-key event)))
                             (.preventDefault event) (.click (shadow-el "save-note")))))
      (.focus (shadow-el "margin-note")))))

(defn show-toolbar! []
  (when-let [{:keys [rect] :as selected} (capture-selection)]
    (when-not (str/blank? (get-in selected [:selector :quote]))
      (swap! state assoc :selection selected)
      (remove-ui! "toolbar")
      (let [toolbar (ui/node
                     [:div {:id "toolbar" :class "surface toolbar" :role "toolbar"
                            :aria-label "Save selection to Margin"
                            :on-mousedown #(.preventDefault %)}
                      [:span {:class "mini-brand" :aria-hidden "true"} "m"]
                      (ui/palette nil quick-save!)
                      (ui/button "button" :note "Note" #(show-editor! (new-annotation)))
                      (ui/icon-button :close "Dismiss toolbar" #(remove-ui! "toolbar"))])]
        (.appendChild shadow toolbar)
        (let [bounds (.getBoundingClientRect toolbar)
              left (max 8 (min (- (.-innerWidth js/window) (.-width bounds) 8) (.-left rect)))
              above (- (.-top rect) (.-height bounds) 9)
              top (max 8 (min (- (.-innerHeight js/window) (.-height bounds) 8)
                             (if (> above 8) above (+ (.-bottom rect) 9))))]
          (set! (.. toolbar -style -left) (str left "px"))
          (set! (.. toolbar -style -top) (str top "px")))))))


(defn repaint! []
  (when (exists? js/Highlight)
    (let [annotations (model/for-page (:annotations @state) (.-href js/location))
          index (when (seq annotations) (text-index))
          ranges (reduce (fn [out a]
                           (if-let [[start end] (anchor/locate (:text index) a)]
                             (if-let [range (range-for index start end)] (assoc out (:id a) {:range range :annotation a}) out)
                             out)) {} annotations)]
      (doseq [color model/colors]
        (let [highlight (js/Highlight.)]
          (doseq [[_ {:keys [range annotation]}] ranges :when (= color (:color annotation))] (.add highlight range))
          (.set js/CSS.highlights (str "margin-" color) highlight)))
      (swap! state assoc :ranges ranges)
      (when (:focus-id @state) (focus! (:focus-id @state))))))

(defn focus! [id]
  (swap! state assoc :focus-id id)
  (if-let [{:keys [range annotation]} (get-in @state [:ranges id])]
    (do
      (swap! state assoc :focus-id nil)
      (js/clearTimeout @focus-timer)
      (reset! focus-timer nil)
      (let [el (.. range -startContainer -parentElement)]
        (.scrollIntoView el #js {:behavior (if (.-matches (.matchMedia js/window "(prefers-reduced-motion: reduce)")) "auto" "smooth")
                                :block "center"}))
      (let [highlight (js/Highlight. range)]
        (set! (.-priority highlight) 10)
        (.set js/CSS.highlights "margin-focus" highlight)
        (js/setTimeout #(.delete js/CSS.highlights "margin-focus") 2500))
      (show-editor! annotation)
      (-> (async/send! {:op "focus-consumed"}) (.catch (fn [_] nil))))
    (when-not @focus-timer
      (reset! focus-timer
              (js/setTimeout
               (fn []
                 (reset! focus-timer nil)
                 (when (= id (:focus-id @state))
                   (swap! state assoc :focus-id nil)
                   (when-let [a (first (filter #(= id (:id %)) (:annotations @state)))]
                     (show-editor! a)
                     (message! "This page has changed. Your saved passage is safe, but could not be located."))
                   (-> (async/send! {:op "focus-consumed"}) (.catch (fn [_] nil)))))
               8000)))))

(defn schedule-paint! []
  ;; Coalesce mutations, but don't starve restoration on continuously updating pages.
  (when-not @debounce-timer
    (reset! debounce-timer (js/setTimeout #(do (reset! debounce-timer nil) (repaint!)) 600))))

(defn on-page-click [event]
  (when (and (not (.includes (.composedPath event) host)) (.-isCollapsed (.getSelection js/window)))
    (remove-ui! "toolbar")
    (when-let [point (.caretRangeFromPoint js/document (.-clientX event) (.-clientY event))]
      (when-let [[_ {:keys [annotation]}]
                 (first (filter (fn [[_ {:keys [range]}]]
                                  (try
                                    (and (.isPointInRange range (.-startContainer point) (.-startOffset point))
                                         (some (fn [rect]
                                                 (and (<= (.-left rect) (.-clientX event) (.-right rect))
                                                      (<= (.-top rect) (.-clientY event) (.-bottom rect))))
                                               (array-seq (.getClientRects range))))
                                    (catch :default _ false))) (:ranges @state)))]
        (show-editor! annotation)))))

(defn init! []
  (set! (.-id host) "margin-extension-root")
  ;; !important protects the host from aggressive page-level CSS resets.
  (.setAttribute host "style" "all:initial!important;position:fixed!important;z-index:2147483647!important;top:0!important;left:0!important;width:0!important;height:0!important;")
  (.appendChild (.-documentElement js/document) host)
  (.appendChild shadow (ui/node [:style {} styles]))
  (.appendChild (.-head js/document)
                (ui/node [:style {:id "margin-highlight-styles"}
                          "::highlight(margin-yellow){background-color:#f4da8599;color:inherit}::highlight(margin-green){background-color:#bed6ae99;color:inherit}::highlight(margin-blue){background-color:#b8d6ec99;color:inherit}::highlight(margin-pink){background-color:#eec3cb99;color:inherit}::highlight(margin-focus){background-color:#edba42;color:#25291f}"]))
  (.addEventListener js/document "mouseup"
                     (fn [event]
                       (when-not (.includes (.composedPath event) host)
                         (js/setTimeout show-toolbar! 10))))
  (.addEventListener js/document "keyup"
                     (fn [event]
                       (when (and (.-shiftKey event) (str/starts-with? (.-key event) "Arrow")) (show-toolbar!))))
  (.addEventListener js/document "click" on-page-click)
  (.addEventListener js/document "keydown"
                     (fn [event] (when (= "Escape" (.-key event)) (remove-ui! "toolbar") (close-editor!))))
  (.addEventListener js/window "scroll" #(remove-ui! "toolbar") #js {:passive true})
  (.addEventListener js/window "resize" #(remove-ui! "toolbar") #js {:passive true})
  (.addEventListener js/window "beforeunload"
                     (fn [event]
                       (when-let [panel (shadow-el "editor")]
                         (when (.-marginDirty panel)
                           (.preventDefault event) (set! (.-returnValue event) "")))))
  (let [observer (js/MutationObserver.
                  (fn [_ _]
                    (when (seq (model/for-page (:annotations @state) (.-href js/location)))
                      (schedule-paint!))))]
    (.observe observer (.-body js/document) #js {:childList true :subtree true :characterData true}))
  (.addListener js/chrome.storage.onChanged
                (fn [^js changes area]
                  (when (and (= area "local") (.-annotations changes))
                    (swap! state assoc :annotations (js->clj (.. changes -annotations -newValue) :keywordize-keys true))
                    (schedule-paint!))))
  (.addListener js/chrome.runtime.onMessage
                (fn [message _ respond]
                  (when (= "focus" (.-type message))
                    (focus! (.-id message)) (respond #js {:ok true}))
                  false))
  ;; History API navigation does not reload content scripts.
  (js/setInterval
   (fn []
     (when (not= (:url @state) (.-href js/location))
       (swap! state assoc :url (.-href js/location) :selection nil)
       (remove-ui! "toolbar")
       (repaint!))) 1000)
  (-> (async/send! {:op "page-ready"})
      (.then (fn [{:keys [annotations focus-id]}]
               (swap! state (fn [s] (assoc s :annotations annotations :focus-id (or (:focus-id s) focus-id))))
               (repaint!)))
      (.catch #(js/console.warn "Margin:" (async/error-message %)))))

(defonce initialized (init!))
