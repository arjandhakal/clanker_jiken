(ns margin.model-test
  (:require [cljs.test :refer-macros [deftest is testing]]
            [clojure.string :as str]
            [margin.model :as model]))

(def sample
  {:id "a1" :url "https://example.com/read?chapter=1#part-2"
   :page-url "https://example.com/read?chapter=1" :title "Learning to notice"
   :quote "Attention is a practice." :note "Try this tomorrow" :color "yellow"
   :prefix "" :suffix "" :start 0 :end 24 :created-at 100 :updated-at 100})

(deftest url-identity
  (is (= "https://example.com/read?chapter=1" (model/canonical-url (:url sample))))
  (is (= [sample] (model/for-page [sample] "https://example.com/read?chapter=1#other")))
  (is (empty? (model/for-page [sample] "https://example.com/read?chapter=2")))
  (doseq [url ["javascript:alert(1)" "file:///tmp/x" "chrome://settings" nil "not a url"]]
    (is (nil? (model/canonical-url url)))))

(deftest validation
  (is (model/valid-annotation? sample))
  (doseq [patch [{:url "javascript:alert(1)"} {:quote "  "} {:note 1} {:color "red"}
                {:prefix nil} {:start -1} {:end 0} {:created-at js/NaN} {:id ""}
                {:note (apply str (repeat 30001 "x"))}]]
    (is (not (model/valid-annotation? (merge sample patch)))))
  (is (= (:page-url sample) (:page-url (model/clean-annotation (assoc sample :page-url "spoofed"))))))

(deftest search-and-filters
  (let [second (assoc sample :id "a2" :note "" :color "blue" :created-at 200)
        annotations [sample second]]
    (is (= [second sample] (model/search annotations "PRACTICE example" :all nil)))
    (is (= [sample] (model/search annotations "tomorrow" :all nil)))
    (is (= [sample] (model/search annotations "" :notes nil)))
    (is (= [second] (model/search annotations "" :all "blue")))
    (is (empty? (model/search annotations "absent" :all nil)))))

(deftest atomic-import
  (let [new-note (assoc sample :id "a2")
        backup {:version 1 :annotations [(assoc sample :note "Must not overwrite") new-note new-note]}
        result (model/import-annotations [sample] backup)]
    (is (= 1 (:added result)))
    (is (= [sample new-note] (:annotations result))))
  (testing "All records must be valid, including duplicate IDs"
    (is (thrown? js/Error (model/import-annotations [sample] {:version 1 :annotations [sample (assoc sample :url "javascript:bad")]}))))
  (doseq [data [nil [] {:version 2 :annotations [sample]} {:version 1 :annotations "bad"}]]
    (is (thrown? js/Error (model/import-annotations [] data)))))

(deftest markdown-export
  (let [output (model/markdown [sample])]
    (is (str/includes? output "> Attention is a practice."))
    (is (str/includes? output (:url sample)))
    (is (str/includes? output "Try this tomorrow"))))
