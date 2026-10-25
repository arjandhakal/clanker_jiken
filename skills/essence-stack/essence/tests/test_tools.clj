(ns essence.tools-test
  (:require [babashka.fs :as fs]
            [babashka.process :as process]
            [cheshire.core :as json]
            [clojure.string :as str]
            [clojure.test :refer [deftest is use-fixtures]]))

(def skill (-> *file* fs/real-path fs/parent fs/parent))
(def stack (fs/parent skill))
(def example (fs/path skill "examples/task-label"))
(load-file (str (fs/path skill "scripts/essence.clj")))
(load-file (str (fs/path skill "scripts/install.clj")))
(require '[essence.tools :as tools] '[essence.install :as installer])

(def ^:dynamic *root*)
(def ^:dynamic *temp*)

(use-fixtures :each
  (fn [test-fn]
    (let [temp (fs/create-temp-dir {:prefix "essence-tests-"}) root (fs/path temp "project")]
      (try
        (fs/copy-tree example root)
        (binding [*root* (fs/real-path root) *temp* (fs/real-path temp)] (test-fn))
        (finally (fs/delete-tree temp))))))

(defn capture [f]
  (let [out (java.io.StringWriter.)]
    (binding [*out* out *err* out]
      {:exit (f) :out (str out)})))

(defn invoke [expected command & args]
  (let [result (capture #(tools/main (into [command (str *root*)] args)))]
    (is (= expected (:exit result)) (:out result))
    (:out result)))

(defn manifest-path [] (fs/path *root* "design/essence/manifest.json"))
(defn change-manifest! [f] (tools/write-json! (manifest-path) (f (tools/read-json (manifest-path)))))
(defn installer-call [expected target & args]
  (let [result (capture #(installer/main (into ["--target-dir" (str target)] args)))]
    (is (= expected (:exit result)) (:out result))
    (:out result)))

(deftest filled-example-strict-build-gate
  (let [out (invoke 0 "check" "--strict" "--require-tests")]
    (is (str/includes? out "STRUCTURE: PASS"))
    (is (str/includes? out "no behavioral verification"))
    (is (= #{"model.clj" "test_model.clj"}
           (set (filter #(str/ends-with? % ".clj")
                        (:tracked (tools/inspect-project *root* (fs/path *root* "design/essence") true))))))))

(deftest init-and-overwrite-refusal
  (let [root (fs/path *temp* "new")]
    (fs/create-dirs root)
    (binding [*root* root]
      (invoke 0 "init")
      (let [before (slurp (str (fs/path root "design/essence/brief.md")))]
        (invoke 2 "init")
        (is (= before (slurp (str (fs/path root "design/essence/brief.md"))))))
      (invoke 0 "check")
      (invoke 1 "check" "--strict"))))

(deftest init-preflights-invalid-subdirectory
  (let [root (fs/path *temp* "new") design (fs/path root "design/essence")]
    (fs/create-dirs design)
    (spit (str (fs/path design "concepts")) "not a directory")
    (binding [*root* root] (invoke 2 "init"))
    (is (not (fs/exists? (fs/path design "brief.md"))))))

(deftest unknown-action-and-duplicate-id
  (change-manifest! #(update-in % [:synchronizations 0 :participants] conj "task.unknown"))
  (is (str/includes? (invoke 1 "check") "unknown action"))
  (change-manifest! #(update % :concepts conj (first (:concepts %))))
  (is (str/includes? (invoke 1 "check") "duplicate id")))

(deftest missing-heading-and-placeholder
  (let [path (fs/path *root* "design/essence/concepts/task.md") original (slurp (str path))]
    (spit (str path) (str/replace original "## Purpose" "## Wrong heading"))
    (is (str/includes? (invoke 1 "check") "## Purpose"))
    (spit (str path) (str original "\nTODO: resolve purpose\n"))
    (invoke 0 "check")
    (invoke 1 "check" "--strict")))

(deftest malformed-manifest-values
  (change-manifest! #(assoc-in % [:concepts 0 :implementation] "not a list"))
  (change-manifest! #(assoc-in % [:concepts 0 :requires_any] [[{}]]))
  (is (str/includes? (invoke 1 "check") "expected a list"))
  (spit (str (manifest-path)) "[]")
  (invoke 2 "check")
  (spit (str (manifest-path)) "{bad json")
  (invoke 2 "check"))

(deftest path-escape-and-missing-file
  (doseq [path ["../secret.txt" (str (fs/path *temp* "secret.txt"))]]
    (change-manifest! #(assoc-in % [:concepts 0 :implementation] [path]))
    (is (str/includes? (invoke 1 "check") "project-relative")))
  (change-manifest! #(assoc-in % [:concepts 0 :implementation] ["missing.clj"]))
  (is (str/includes? (invoke 1 "check") "missing file")))

(deftest symlink-escape
  (let [outside (fs/path *temp* "outside.clj")]
    (spit (str outside) "private")
    (fs/create-sym-link (fs/path *root* "leak.clj") outside)
    (change-manifest! #(assoc-in % [:concepts 0 :implementation] ["leak.clj"]))
    (is (str/includes? (invoke 1 "check") "escapes project"))))

(deftest dangling-symlink-and-symlink-design-escape
  (fs/create-sym-link (fs/path *root* "dangling") (fs/path *temp* "missing"))
  (invoke 2 "init" "--design" "dangling/subdir")
  (is (not (fs/exists? (fs/path *temp* "missing"))))
  (fs/create-sym-link (fs/path *root* "outside") *temp*)
  (invoke 2 "init" "--design" "outside/new-design")
  (is (not (fs/exists? (fs/path *temp* "new-design"))))
  (invoke 2 "init" "--design" "."))

(deftest build-traceability-gate
  (change-manifest! #(assoc % :traces []))
  (invoke 0 "check")
  (is (str/includes? (invoke 1 "check" "--require-tests") "no trace with test references")))

(deftest unknown-dependencies-and-trace-refs
  (change-manifest! #(assoc-in % [:concepts 0 :requires_any] [["missing"]]))
  (change-manifest! #(assoc-in % [:traces 0 :synchronizations] ["unknown"]))
  (let [out (invoke 1 "check")]
    (is (str/includes? out "unknown concept dependency"))
    (is (str/includes? out "unknown synchronizations reference"))))

(deftest baseline-requires-ack
  (invoke 2 "baseline")
  (is (not (fs/exists? (fs/path *root* "design/essence/.baseline.json"))))
  (invoke 2 "drift"))

(deftest baseline-and-changed-added-removed-drift
  (invoke 0 "baseline" "--ack-reviewed")
  (invoke 0 "drift")
  (spit (str (fs/path *root* "model.clj")) "\n;; behavior needs review\n" :append true)
  (is (str/includes? (invoke 1 "drift") "CHANGED: model.clj"))
  (let [extra (fs/path *root* "design/essence/lesson.md")]
    (spit (str extra) "# A newly recorded lesson\n")
    (is (str/includes? (invoke 1 "drift") "ADDED:"))
    (invoke 0 "baseline" "--ack-reviewed")
    (fs/delete extra)
    (is (str/includes? (invoke 1 "drift") "REMOVED:"))))

(deftest missing-tracked-code-is-removed
  (invoke 0 "baseline" "--ack-reviewed")
  (fs/delete (fs/path *root* "model.clj"))
  (let [out (invoke 1 "drift")]
    (is (str/includes? out "missing file: model.clj"))
    (is (str/includes? out "REMOVED: model.clj"))))

(deftest baseline-draft-and-symlink-refusal
  (let [review (fs/path *root* "design/essence/review.md") baseline (fs/path *root* "design/essence/.baseline.json")
        target (fs/path *root* "untouched.json")]
    (spit (str review) "Status: draft\n")
    (invoke 2 "baseline" "--ack-reviewed")
    (fs/delete review)
    (spit (str target) "keep me")
    (fs/create-sym-link baseline target)
    (invoke 2 "baseline" "--ack-reviewed")
    (is (= "keep me" (slurp (str target))))))

(deftest baseline-does-not-follow-untrusted-paths
  (tools/write-json! (fs/path *root* "design/essence/.baseline.json")
                     {:schema_version 1 :files {"../../secret" "dummy"}})
  (is (str/includes? (invoke 1 "drift") "REMOVED: ../../secret")))

(deftest installer-collision-idempotency-and-owned-uninstall
  (let [target (fs/path *temp* "skills") collision (fs/path target "essence-review")]
    (fs/create-dirs collision)
    (installer-call 2 target)
    (is (not (fs/exists? (fs/path target "essence"))))
    (fs/delete collision)
    (installer-call 0 target)
    (installer-call 0 target)
    (is (= 8 (count (fs/list-dir target))))
    (doseq [directory (fs/list-dir target)]
      (is (fs/sym-link? directory))
      (is (fs/regular-file? (fs/path directory "SKILL.md"))))
    (installer-call 0 target "--uninstall")
    (is (empty? (fs/list-dir target)))))

(deftest installer-refuses-dangling-links-and-foreign-uninstall
  (let [target (fs/path *temp* "skills")]
    (fs/create-dirs target)
    (fs/create-sym-link (fs/path target "essence-review") (fs/path *temp* "gone"))
    (installer-call 2 target)
    (is (= 1 (count (fs/list-dir target))))
    (installer-call 2 target "--uninstall")
    (is (fs/sym-link? (fs/path target "essence-review")))))

(deftest cli-from-unrelated-directory-and-symlink
  (let [target (fs/path *temp* "skills")]
    (installer-call 0 target)
    (doseq [[script args expected] [["essence.clj" ["--help"] 0]
                                    ["essence.clj" ["check" (str *root*) "--strict" "--require-tests"] 0]
                                    ["essence.clj" ["check" "--bad-option"] 2]
                                    ["install.clj" ["--help"] 0]]]
      (let [result @(process/process (into ["bb" (str (fs/path target "essence/scripts" script))] args)
                                     {:dir (str *temp*) :out :string :err :string})]
        (is (= expected (:exit result)) (str (:out result) (:err result)))))))

(deftest skill-frontmatter-and-local-links
  (let [skills (fs/glob stack "*/SKILL.md")]
    (is (= 8 (count skills)))
    (doseq [path skills]
      (let [text (slurp (str path)) front (second (re-find #"(?s)\A---\n(.*?)\n---\n" text))
            name (second (re-find #"(?m)^name: (.+)$" (or front "")))
            description (second (re-find #"(?m)^description: (.+)$" (or front "")))]
        (is (some? front) (str path))
        (is (= name (fs/file-name (fs/parent path))))
        (is (tools/valid-id? name))
        (is (<= (count name) 64))
        (is (<= 1 (count description) 1024))
        (is (< (count (str/split-lines text)) 500))))
    (doseq [path (fs/glob stack "**.md")
            [_ link] (re-seq #"\[[^\]]*\]\(([^)]+)\)" (slurp (str path)))
            :when (not (or (str/includes? link "://") (str/starts-with? link "#")))]
      (is (fs/exists? (fs/path (fs/parent path) (first (str/split link #"#"))))
          (str "broken link in " path ": " link)))))
