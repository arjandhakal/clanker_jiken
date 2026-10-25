#!/usr/bin/env bb
(ns essence.install
  "Non-overwriting global installation of all eight sibling skills."
  (:require [babashka.fs :as fs]
            [clojure.string :as str]))

(def stack (-> *file* fs/real-path fs/parent fs/parent fs/parent))
(def names ["essence" "essence-discover" "essence-concept" "essence-compose"
            "essence-map" "essence-build" "essence-review" "essence-evolve"])
(def default-target
  (fs/path (or (System/getenv "PI_CODING_AGENT_DIR") (fs/path (fs/home) ".pi/agent")) "skills"))
(def usage "Usage: bb install.clj [--target-dir path] [--uninstall]\nDefault: Pi's global skills directory (~/.pi/agent/skills, or PI_CODING_AGENT_DIR/skills).")

(defn fail! [message] (throw (ex-info message {})))
(defn owned? [destination source]
  (and (fs/sym-link? destination)
       (try (= (fs/real-path destination) (fs/real-path source)) (catch Exception _ false))))

(defn parse-args [args]
  (loop [args args opts {:target-dir default-target}]
    (if-let [arg (first args)]
      (case arg
        "--uninstall" (recur (next args) (assoc opts :uninstall true))
        "--target-dir" (if-let [path (second args)]
                         (recur (nnext args) (assoc opts :target-dir path))
                         (fail! "--target-dir needs a path"))
        (fail! (str "unknown argument: " arg)))
      opts)))

(defn install! [{:keys [target-dir uninstall]}]
  (let [target (-> target-dir fs/expand-home fs/absolutize fs/normalize)
        plan (vec
              (for [name names
                    :let [source (fs/path stack name)
                          destination (fs/path target name)
                          exists? (fs/exists? destination {:nofollow-links true})
                          owned (owned? destination source)]
                    :when (do
                            (when-not (fs/regular-file? (fs/path source "SKILL.md"))
                              (fail! (str "incomplete stack: " source)))
                            (when (and exists? (not owned))
                              (fail! (str (if uninstall "not an owned symlink; refusing removal: "
                                              "collision; refusing overwrite: ") destination)))
                            (if uninstall owned (not owned)))]
                [destination source]))]
    ;; Realize and validate the complete plan before any mutation.
    (when-not uninstall (fs/create-dirs target))
    (doseq [[destination source] plan]
      (if uninstall
        (do
          (when-not (owned? destination source)
            (fail! (str "link changed after preflight; refusing removal: " destination)))
          (fs/delete destination)
          (println "Removed owned link:" (str destination)))
        (do
          ;; Creating a symlink refuses a racing collision; nothing is replaced.
          (fs/create-sym-link destination source)
          (println "Installed:" (str destination) "->" (str source)))))
    (when (empty? plan) (println "Already in requested state; no changes."))
    (when-not uninstall
      (println "Global discovery links are ready. In Pi run /reload or start a new session.")
      (println "Keep this checkout in place; install the complete stack, not a single leaf."))
    0))

(defn main [args]
  (if (some #{"--help" "-h"} args)
    (do (println usage) 0)
    (try (install! (parse-args args))
         (catch Exception e (binding [*out* *err*] (println "ERROR:" (ex-message e))) 2))))

(when (= (str (fs/real-path *file*)) (some-> (System/getProperty "babashka.file") fs/real-path str))
  (System/exit (main *command-line-args*)))
