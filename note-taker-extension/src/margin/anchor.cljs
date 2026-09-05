(ns margin.anchor
  (:require [clojure.string :as str]))

(defn occurrences [text quote]
  (when-not (str/blank? quote)
    (loop [from 0 found []]
      (let [i (.indexOf text quote from)]
        (if (neg? i) found (recur (inc i) (conj found i)))))))

(defn common-prefix [a b]
  (loop [i 0]
    (if (and (< i (min (count a) (count b))) (= (nth a i) (nth b i)))
      (recur (inc i)) i)))

(defn common-suffix [a b]
  (common-prefix (str/reverse a) (str/reverse b)))

(defn best-match [text {:keys [quote prefix suffix start]}]
  (let [candidates (occurrences text quote)
        size (count quote)
        score (fn [i]
                [(+ (common-suffix (subs text (max 0 (- i (count prefix))) i) prefix)
                    (common-prefix (subs text (+ i size) (min (count text) (+ i size (count suffix)))) suffix))
                 (- (js/Math.abs (- i (or start 0))))])]
    (when (seq candidates)
      (let [i (last (sort-by score candidates))] [i (+ i size)]))))

(defn normalize-index [text]
  ;; Maintain UTF-16 offsets so browser Range offsets also work for emoji.
  (loop [i 0 out [] positions [] space? false]
    (if (= i (count text))
      {:text (apply str out) :positions positions}
      (let [c (.charAt text i) ws? (boolean (re-matches #"\s" c))]
        (if (and ws? space?)
          (recur (inc i) out positions true)
          (recur (inc i) (conj out (if ws? " " c)) (conj positions i) ws?))))))

(defn locate [text selector]
  (or (best-match text selector)
      (let [{normalized :text positions :positions} (normalize-index text)
            normalize #(:text (normalize-index %))
            normalized-start (count (normalize (subs text 0 (min (count text) (or (:start selector) 0)))))]
        (when-let [[start end] (best-match normalized
                                          (-> selector
                                              (update :quote normalize)
                                              (update :prefix normalize)
                                              (update :suffix normalize)
                                              (assoc :start normalized-start)))]
          [(nth positions start) (if (< end (count positions)) (nth positions end) (count text))]))))

(defn selector [text start end]
  {:quote (subs text start end)
   :prefix (subs text (max 0 (- start 64)) start)
   :suffix (subs text end (min (count text) (+ end 64)))
   :start start :end end})
