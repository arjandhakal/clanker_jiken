(ns margin.anchor-test
  (:require [cljs.test :refer-macros [deftest is testing]]
            [margin.anchor :as anchor]))

(deftest selectors-and-restoration
  (let [text "Before this, an idea worth keeping. After this, more ideas."
        start (.indexOf text "an idea")
        end (+ start (count "an idea worth keeping."))
        selector (anchor/selector text start end)]
    (is (= [start end] (anchor/locate text selector)))
    (testing "Inserted text does not break an anchor"
      (is (= [(+ 9 start) (+ 9 end)] (anchor/locate (str "New intro" text) selector))))
    (testing "Missing text stays unresolved rather than highlighting an unrelated position"
      (is (nil? (anchor/locate "A completely different article." selector))))))

(deftest repeated-quotes-use-context
  (let [text "First: keep this. Second: keep this. Third: keep this."
        start (.indexOf text "keep this" 20)
        selector (anchor/selector text start (+ start 9))
        intro "First: keep this. An introduction. "
        changed (str intro text)]
    (is (= [start (+ start 9)] (anchor/locate text selector)))
    (is (= [(+ (count intro) start) (+ (count intro) start 9)] (anchor/locate changed selector))))
  (is (= [8 12] (anchor/locate "same xx same" {:quote "same" :prefix "" :suffix "" :start 8}))))

(deftest whitespace-and-unicode
  (let [selector (anchor/selector "A thoughtful idea is here" 2 17)
        text "A thoughtful\n   idea is here"
        [start end] (anchor/locate text selector)]
    (is (= "thoughtful\n   idea" (subs text start end))))
  (let [text "Read 📚 and remember ✨."
        selector (anchor/selector text 5 11)]
    (is (= [5 11] (anchor/locate text selector))))
  (is (nil? (anchor/locate "some text" {:quote "" :prefix "" :suffix "" :start 0}))))
