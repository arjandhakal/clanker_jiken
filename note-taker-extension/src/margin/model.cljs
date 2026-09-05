(ns margin.model
  (:require [clojure.string :as str]))

(def colors ["yellow" "green" "blue" "pink"])
(def color-labels {"yellow" "Sunshine" "green" "Sage" "blue" "Sky" "pink" "Rose"})
(def max-quote-length 20000)
(def max-note-length 30000)

(defn canonical-url [url]
  (try
    (let [u (js/URL. url)]
      ;; Queries are significant; only fragments are excluded from page identity.
      (when (contains? #{"http:" "https:"} (.-protocol u))
        (set! (.-hash u) "")
        (.-href u)))
    (catch :default _ nil)))

(defn domain [url]
  (try (str/replace (.-hostname (js/URL. url)) #"^www\." "")
       (catch :default _ "Unknown website")))

(defn valid-annotation? [a]
  (and (map? a)
       (string? (:id a)) (<= 1 (count (:id a)) 100)
       (string? (:url a)) (<= (count (:url a)) 10000)
       (some? (canonical-url (:url a)))
       (string? (:title a)) (<= (count (:title a)) 2000)
       (string? (:quote a)) (not (str/blank? (:quote a)))
       (<= (count (:quote a)) max-quote-length)
       (string? (:note a)) (<= (count (:note a)) max-note-length)
       (some #{(:color a)} colors)
       (every? #(and (string? %) (<= (count %) 100)) [(:prefix a) (:suffix a)])
       (every? #(and (number? %) (js/Number.isFinite %) (<= 0 %))
               [(:created-at a) (:updated-at a)])
       (integer? (:start a)) (<= 0 (:start a))
       (integer? (:end a)) (< (:start a) (:end a))))

(def annotation-keys
  [:id :url :page-url :title :quote :note :color :prefix :suffix :start :end :created-at :updated-at])

(defn clean-annotation [a]
  (assoc (select-keys a annotation-keys) :page-url (canonical-url (:url a))))

(defn for-page [annotations url]
  (let [key (canonical-url url)]
    (if key (filterv #(= key (:page-url %)) annotations) [])))

(defn search [annotations query view color]
  (let [words (remove str/blank? (str/split (str/lower-case (str/trim query)) #"\s+"))]
    (->> annotations
         (filter #(or (not= view :notes) (not (str/blank? (:note %)))))
         (filter #(or (nil? color) (= color (:color %))))
         (filter (fn [a]
                   (let [text (str/lower-case (str/join " " [(:title a) (:url a) (:quote a) (:note a)]))]
                     (every? #(str/includes? text %) words))))
         (sort-by :created-at >)
         vec)))

(defn import-annotations [existing data]
  (when-not (and (map? data) (= 1 (:version data))
                 (vector? (:annotations data)) (<= (count (:annotations data)) 10000)
                 (every? valid-annotation? (:annotations data)))
    (throw (js/Error. "This is not a valid Margin backup (version 1). Nothing was imported.")))
  ;; Imported IDs never overwrite an existing local note.
  (let [local-ids (set (map :id existing))
        additions (->> (:annotations data)
                       (remove #(contains? local-ids (:id %)))
                       (map clean-annotation)
                       (reduce #(assoc %1 (:id %2) %2) {}) vals vec)]
    {:annotations (into (vec existing) additions) :added (count additions)}))

(defn markdown [annotations]
  (str "# Margin — Reading notes\n\n"
       (str/join "\n---\n\n"
                 (for [a (sort-by :created-at > annotations)]
                   (str "## " (str/replace (:title a) #"[\r\n]+" " ") "\n\n"
                        "Source: " (:url a) "\n\n"
                        "> " (str/replace (:quote a) "\n" "\n> ") "\n\n"
                        (when-not (str/blank? (:note a)) (str (:note a) "\n\n")))))))
