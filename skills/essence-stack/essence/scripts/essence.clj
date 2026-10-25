#!/usr/bin/env bb
(ns essence.tools
  "Structural artifact checks and reviewed fingerprints; not a semantic verifier."
  (:refer-clojure :exclude [run!])
  (:require [babashka.fs :as fs]
            [cheshire.core :as json]
            [clojure.set :as set]
            [clojure.string :as str])
  (:import [java.security MessageDigest]))

(def skill (-> *file* fs/real-path fs/parent fs/parent))
(def id-pattern #"[a-z0-9]+(?:-[a-z0-9]+)*")
(def placeholder #"(?i)\b(?:TODO|TBD|FIXME)\b|Status:\s*draft")
(def sections
  {:concepts ["Purpose" "Parameters" "Operational principle" "State" "Initial state"
              "Invariants" "Actions" "Boundaries" "Misfits and variants" "Evidence"]
   :synchronizations ["Intent" "Participants" "Trigger" "Guard and bindings" "Response"
                      "Consistency and failure" "Concurrency and termination"
                      "Preserved integrity" "Traces and evidence"]
   :traces ["Purpose" "Setup" "Steps" "Expected observations" "Projection and invariants"
            "Implementation evidence"]})

(defn fail! [message] (throw (ex-info message {})))
(defn valid-id? [x] (and (string? x) (boolean (re-matches id-pattern x))))
(defn present? [path] (fs/exists? path {:nofollow-links true}))
(defn read-json [path] (json/parse-string (slurp (str path)) true))
(defn write-json! [path value] (spit (str path) (str (json/generate-string value {:pretty true}) "\n")))
(defn relative [root path] (str (fs/relativize root path)))

(defn resolve-path
  "Resolve existing symlinks even in a path whose final components do not exist.
  A dangling symlink is rejected rather than treated as an ordinary missing path."
  [path]
  (let [path (fs/absolutize path)]
    (if (present? path)
      (fs/real-path path)
      (fs/path (resolve-path (fs/parent path)) (fs/file-name path)))))

(defn safe-file
  ([root path] (safe-file root path true))
  ([root path must-exist?]
   (when-not (and (string? path) (not (str/blank? path)))
     (fail! "path must be a nonempty string"))
   (when (or (fs/absolute? path) (some #{".."} (map str (seq (fs/path path)))))
     (fail! (str "path must be project-relative without '..': " path)))
   (let [resolved (resolve-path (fs/path root path))]
     (when-not (.startsWith resolved root)
       (fail! (str "path escapes project (including symlinks): " path)))
     (when (and must-exist? (not (fs/regular-file? resolved)))
       (fail! (str "missing file: " path)))
     resolved)))

(defn design-path [root path]
  (let [resolved (safe-file root path false)]
    (when (= root resolved) (fail! "design directory must be below the project root"))
    resolved))

(defn inspect-project [root design require-tests?]
  (let [manifest-path (safe-file root (relative root (fs/path design "manifest.json")))
        manifest (read-json manifest-path)
        errors (atom []) warnings (atom []) tracked (atom #{(relative root manifest-path)})
        records (atom {}) actions (atom {})
        error! #(swap! errors conj %)
        warn! #(swap! warnings conj %)]
    (when-not (and (map? manifest) (integer? (:schema_version manifest)) (= 1 (:schema_version manifest)))
      (fail! "manifest must be an object with schema_version: 1"))
    (letfn [(record-file! [value context]
              (try
                (let [path (safe-file root value)] (swap! tracked conj value) path)
                (catch Exception e (error! (str context ": " (ex-message e))) nil)))
            (path-list! [value context]
              (if-not (vector? value)
                (do (error! (str context ": expected a list of file paths")) [])
                (do (doseq [entry value] (record-file! entry context)) value)))]
      (doseq [[kind required] sections]
        (swap! records assoc kind {})
        (if-not (vector? (get manifest kind))
          (error! (str (name kind) ": expected a list"))
          (doseq [entry (get manifest kind)]
            (let [ident (:id entry) context (str (name kind) "/" ident)]
              (cond
                (not (map? entry)) (error! (str (name kind) ": each entry must be an object"))
                (not (valid-id? ident)) (error! (str (name kind) ": invalid id " (pr-str ident)))
                (contains? (get @records kind) ident) (error! (str context ": duplicate id"))
                :else
                (do
                  (swap! records assoc-in [kind ident] entry)
                  (when-let [path (record-file! (:spec entry) context)]
                    (let [text (slurp (str path))
                          blocks (re-seq #"(?ms)^## ([^\n]+)\n(.*?)(?=^## |\z)" text)
                          headings (frequencies (map second blocks))
                          bodies (into {} (map (fn [[_ h body]] [h body]) blocks))]
                      (doseq [heading required]
                        (cond
                          (not= 1 (get headings heading))
                          (error! (str (:spec entry) ": expected exactly one '## " heading "'"))
                          (str/blank? (get bodies heading))
                          (error! (str (:spec entry) ": empty section " heading))))
                      (when (= kind :concepts)
                        (let [names (map second (re-seq #"(?m)^### (.+)$" (get bodies "Actions" "")))]
                          (when (or (empty? names) (not= (count names) (count (set names)))
                                    (not-every? valid-id? names))
                            (error! (str (:spec entry) ": action headings must be unique kebab-case IDs")))
                          (swap! actions assoc ident (set names))))))
                  (let [key (if (= kind :traces) :tests :implementation)
                        paths (path-list! (get entry key []) (str context "/" (name key)))]
                    (when (and require-tests? (empty? paths))
                      (error! (str context ": build gate requires " (name key) " paths"))))))))))
      (let [{:keys [concepts synchronizations traces]} @records
            covered (atom {:concepts #{} :synchronizations #{}})]
        (when (empty? concepts) (warn! "inventory is empty: scaffold is not a concept design"))
        (doseq [[ident entry] concepts]
          (let [groups (get entry :requires_any [])]
            (if-not (vector? groups)
              (error! (str ident ": requires_any must be an OR-list of AND-lists"))
              (doseq [group groups]
                (if-not (and (vector? group) (seq group))
                  (error! (str ident ": each dependency alternative must be a nonempty list"))
                  (doseq [dep group]
                    (cond
                      (not (and (string? dep) (contains? concepts dep)))
                      (error! (str ident ": unknown concept dependency " (pr-str dep)))
                      (= dep ident) (error! (str ident ": self-dependence does not justify inclusion")))))))))
        (doseq [[ident entry] synchronizations]
          (let [participants (:participants entry) seen (atom #{})]
            (if-not (and (vector? participants) (<= 2 (count participants)))
              (error! (str ident ": participants must list at least two qualified actions"))
              (do
                (doseq [participant participants]
                  (if-let [[_ concept action] (and (string? participant) (re-matches #"([^.]+)\.([^.]+)" participant))]
                    (do (swap! seen conj concept)
                        (when-not (contains? (get @actions concept #{}) action)
                          (error! (str ident ": unknown action " participant))))
                    (error! (str ident ": invalid participant " (pr-str participant)))))
                (when (< (count @seen) 2)
                  (error! (str ident ": synchronization must involve distinct concept instances")))))))
        (doseq [[ident entry] traces
                [kind targets] [[:concepts concepts] [:synchronizations synchronizations]]]
          (let [refs (get entry kind [])]
            (if-not (vector? refs)
              (error! (str "trace " ident ": " (name kind) " must be a list"))
              (do
                (doseq [ref refs]
                  (if-not (and (string? ref) (contains? targets ref))
                    (error! (str "trace " ident ": unknown " (name kind) " reference " (pr-str ref)))
                    (when (and (vector? (:tests entry)) (seq (:tests entry)))
                      (swap! covered update kind conj ref))))
                (when (and (= kind :concepts) (empty? refs))
                  (error! (str "trace " ident ": must reference at least one concept")))))))
        (when (empty? traces) (warn! "no purpose-demonstrating traces registered"))
        (let [mappings (path-list! (get manifest :mappings []) "mappings")]
          (when require-tests?
            (when (empty? mappings) (error! "build gate requires a mapping file"))
            (doseq [[kind targets] [[:concepts concepts] [:synchronizations synchronizations]]
                    ident (set/difference (set (keys targets)) (get @covered kind))]
              (error! (str (name kind) "/" ident ": no trace with test references"))))))
      ;; Do not follow directory symlinks or execute any artifact contents.
      (doseq [path (fs/glob design "**.md")]
        (record-file! (relative root path) "design artifact"))
      (doseq [path (sort @tracked) :when (str/ends-with? path ".md")]
        (when (re-find placeholder (slurp (str (safe-file root path))))
          (warn! (str path ": draft marker or unresolved placeholder"))))
      {:errors @errors :warnings @warnings :tracked @tracked})))

(defn init-project! [root design]
  (let [templates ["brief.md" "mapping.md" "decisions.md" "journal.md" "review.md"]
        plan (assoc (into {} (for [name templates] [name (slurp (str (fs/path skill "assets" name)))]))
                    "manifest.json" (str (json/generate-string
                                          {:schema_version 1 :concepts [] :synchronizations [] :traces [] :mappings []}
                                          {:pretty true}) "\n"))]
    (doseq [name (keys plan)]
      (when (present? (fs/path design name))
        (fail! (str "refusing to overwrite existing workspace file: " (fs/path design name)))))
    (doseq [name ["concepts" "synchronizations" "traces"]
            :let [dest (fs/path design name)]]
      (when (or (fs/sym-link? dest) (and (present? dest) (not (fs/directory? dest))))
        (fail! (str "unsafe or non-directory workspace destination: " dest))))
    (fs/create-dirs design)
    (doseq [[name content] plan]
      (java.nio.file.Files/write
       (fs/path design name) (.getBytes content "UTF-8")
       (into-array java.nio.file.OpenOption
                   [java.nio.file.StandardOpenOption/CREATE_NEW java.nio.file.StandardOpenOption/WRITE])))
    (doseq [name ["concepts" "synchronizations" "traces"]] (fs/create-dirs (fs/path design name)))
    (println "Created draft workspace:" (str design))
    (println "No concepts, application code, or test results have been generated.")
    0))

(defn fingerprints [root tracked]
  (into (sorted-map)
        (for [path (sort tracked)
              :let [digest (.digest (MessageDigest/getInstance "SHA-256")
                                    (fs/read-all-bytes (safe-file root path)))]]
          [path (apply str (map #(format "%02x" (bit-and 0xff %)) digest))])))

(defn run! [{:keys [command project design strict require-tests ack-reviewed]}]
  (let [root (fs/real-path (fs/expand-home project))
        _ (when-not (fs/directory? root) (fail! (str "project directory does not exist: " root)))
        design (design-path root design)]
    (if (= command "init")
      (init-project! root design)
      (let [{:keys [errors warnings tracked]} (inspect-project root design require-tests)]
        (doseq [error errors] (println "ERROR:" error))
        (doseq [warning warnings] (println "WARNING:" warning))
        (if (= command "check")
          (let [failed? (or (seq errors) (and strict (seq warnings)))]
            (println (str "STRUCTURE: " (if failed? "FAIL" "PASS") "; no behavioral verification or test execution performed"))
            (if failed? 1 0))
          (let [baseline (safe-file root (relative root (fs/path design ".baseline.json")) false)]
            (cond
              (= command "baseline")
              (do
                (when-not ack-reviewed (fail! "baseline requires --ack-reviewed after an actual alignment review"))
                (when (or (seq errors) (seq warnings))
                  (fail! "resolve structural errors and draft warnings before recording a baseline"))
                (when (fs/sym-link? (fs/path design ".baseline.json"))
                  (fail! "baseline destination must not be a symlink"))
                (write-json! baseline {:schema_version 1 :files (fingerprints root tracked)})
                (println "Recorded reviewed fingerprint baseline:" (str baseline))
                0)
              (not (fs/regular-file? baseline))
              (do (println "NO BASELINE: run baseline --ack-reviewed only after alignment review") 2)
              :else
              ;; Baseline keys are comparison labels only; never open their paths.
              (let [old (json/parse-string (slurp (str baseline)))
                    _ (when-not (and (map? old) (= 1 (get old "schema_version"))
                                     (map? (get old "files"))
                                     (every? (fn [[k v]] (and (string? k) (string? v))) (get old "files")))
                        (fail! "invalid baseline format"))
                    before (get old "files") now (fingerprints root tracked)
                    old-keys (set (keys before)) new-keys (set (keys now))
                    changes {"ADDED" (set/difference new-keys old-keys)
                             "REMOVED" (set/difference old-keys new-keys)
                             "CHANGED" (set (filter #(not= (get before %) (get now %)) (set/intersection old-keys new-keys)))}]
                (doseq [[kind paths] (sort changes) path (sort paths)] (println (str kind ": " path)))
                (if (or (seq errors) (seq warnings) (some seq (vals changes)))
                  (do (println "REVIEW REQUIRED: drift/structure signals are not semantic conclusions") 1)
                  (do (println "NO TRACKED DRIFT: content matches baseline; undeclared files and semantics are not checked") 0))))))))))

(def usage "Usage: bb essence.clj {init|check|baseline|drift} [project] [--design path] [--strict] [--require-tests] [--ack-reviewed]")

(defn parse-args [args]
  (loop [args args opts {:project "." :design "design/essence"} positional []]
    (if-let [arg (first args)]
      (cond
        (= arg "--design") (if-let [path (second args)]
                              (recur (nnext args) (assoc opts :design path) positional)
                              (fail! "--design needs a path"))
        (#{"--strict" "--require-tests" "--ack-reviewed"} arg)
        (recur (next args) (assoc opts (keyword (subs arg 2)) true) positional)
        (str/starts-with? arg "--") (fail! (str "unknown option: " arg))
        :else (recur (next args) opts (conj positional arg)))
      (let [[command project] positional]
        (when-not (and (#{"init" "check" "baseline" "drift"} command) (<= 1 (count positional) 2))
          (fail! usage))
        (cond-> (assoc opts :command command) project (assoc :project project))))))

(defn main [args]
  (if (some #{"--help" "-h"} args)
    (do (println usage) 0)
    (try (run! (parse-args args))
         (catch Exception e
           (binding [*out* *err*] (println "ERROR:" (or (ex-message e) (str (class e)))))
           2))))

(when (= (str (fs/real-path *file*)) (some-> (System/getProperty "babashka.file") fs/real-path str))
  (System/exit (main *command-line-args*)))
