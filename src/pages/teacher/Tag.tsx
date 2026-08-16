import { useEffect, useState } from "react";
import TeacherShell from "../../components/TeacherShell";
import { supabase } from "../../lib/supabase";

interface TagRow {
  id: string;
  tag_code: string;
  label: string;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

// Web NFC is only exposed on Chrome/Edge for Android over HTTPS.
function nfcSupported(): boolean {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

type WriteState = "idle" | "waiting" | "success" | "error";

export default function Tag() {
  const [tag, setTag] = useState<TagRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [writeState, setWriteState] = useState<WriteState>("idle");
  const [writeMsg, setWriteMsg] = useState<string>("");

  async function load() {
    const { data } = await supabase
      .from("tags")
      .select("id, tag_code, label")
      .maybeSingle();
    setTag((data as any) ?? null);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function createTag() {
    const { data: userData } = await supabase.auth.getUser();
    const { data: teacher } = await supabase
      .from("teachers")
      .select("full_name")
      .eq("id", userData.user!.id)
      .single();
    const name = teacher?.full_name ?? "teacher";
    const code = `${slugify(name)}-${Math.random().toString(36).slice(2, 6)}`;
    const { data, error } = await supabase
      .from("tags")
      .insert({
        teacher_id: userData.user!.id,
        tag_code: code,
        label: `${name}'s tag`,
      })
      .select("id, tag_code, label")
      .single();
    if (!error && data) setTag(data as any);
  }

  const url = tag ? `${window.location.origin}/t/${tag.tag_code}` : "";

  async function writeToTag() {
    if (!nfcSupported()) return;
    setWriteState("waiting");
    setWriteMsg("Hold an NFC tag to the back of your phone…");
    try {
      // @ts-expect-error NDEFReader is not yet in the TS DOM lib
      const ndef = new NDEFReader();
      await ndef.write({ records: [{ recordType: "url", data: url }] });
      setWriteState("success");
      setWriteMsg(
        "Written. Now open NFC Tools and set a password or lock the tag so students can't overwrite it (see below).",
      );
    } catch (e: any) {
      setWriteState("error");
      if (e?.name === "NotAllowedError") {
        setWriteMsg("Permission denied. Allow NFC and try again.");
      } else if (e?.name === "NotSupportedError") {
        setWriteMsg("This device can't write NFC from the browser. Use the copy method below.");
      } else {
        setWriteMsg("Couldn't write the tag. Try again, or use the copy method below.");
      }
    }
  }

  return (
    <TeacherShell>
      <h1 className="font-display text-2xl font-bold text-navy">My tag</h1>
      {loading ? (
        <p className="mt-6 text-slate-400">Loading…</p>
      ) : !tag ? (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-8 text-center">
          <p className="text-slate-600">
            You don't have a tag yet. Create one, then write its URL to an NFC
            tag.
          </p>
          <button
            onClick={createTag}
            className="mt-5 bg-navy text-white font-medium rounded-lg px-5 py-2.5"
          >
            Create my tag
          </button>
        </div>
      ) : (
        <div className="mt-6 bg-white border border-slate-200 rounded-xl p-8 max-w-2xl">
          <p className="text-sm text-slate-500">{tag.label}</p>

          {nfcSupported() ? (
            <div className="mt-6">
              <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">
                Write directly from this phone
              </p>
              <button
                onClick={writeToTag}
                disabled={writeState === "waiting"}
                className="w-full sm:w-auto bg-red text-white font-medium rounded-lg px-6 py-3 disabled:opacity-50"
              >
                {writeState === "waiting" ? "Waiting for tag…" : "Write to NFC tag"}
              </button>
              {writeState !== "idle" && (
                <p
                  className={`mt-3 text-sm ${
                    writeState === "success"
                      ? "text-signal"
                      : writeState === "error"
                        ? "text-halt"
                        : "text-slate-500"
                  }`}
                >
                  {writeMsg}
                </p>
              )}
              <div className="mt-6 border-t border-slate-100" />
            </div>
          ) : (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              Direct tag-writing from the browser needs Chrome or Edge on
              Android. On iPhone or desktop, use the copy method below with a
              free NFC writer app.
            </div>
          )}

          <p className="text-xs uppercase tracking-wide text-slate-400 mt-6 mb-2">
            Or copy the tag URL
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-800 break-all">
              {url}
            </code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="bg-navy text-white text-sm font-medium rounded-lg px-4 py-3 whitespace-nowrap"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-6 text-sm text-slate-500 leading-relaxed">
            <p className="font-medium text-slate-700">
              Writing with an app (iPhone / desktop / any phone):
            </p>
            <ol className="list-decimal ml-5 mt-2 space-y-1">
              <li>Install the free "NFC Tools" app.</li>
              <li>Write &rarr; Add a record &rarr; URL &rarr; paste the URL above.</li>
              <li>Hold your phone to the tag to write it.</li>
            </ol>
          </div>

          <div className="mt-6 bg-navy/5 border border-navy/15 rounded-lg px-4 py-4 text-sm text-slate-700 leading-relaxed">
            <p className="font-semibold text-navy">
              Protect the tag so students can't overwrite it
            </p>
            <p className="mt-1.5">
              Reading a tag (a check-in) always stays free. You only need to stop
              other phones <em>writing</em> to it. Do one of these in NFC Tools
              after writing, using the <span className="font-medium">Other</span>
              {" "}tab:
            </p>
            <ul className="list-disc ml-5 mt-2 space-y-1.5">
              <li>
                <span className="font-medium">Set a password</span> (recommended)
                — "Set password" locks writing behind a password you choose.
                Students can still tap to check in; only you can change the tag
                later. Keep the password safe — you'll need it to rewrite the
                tag.
              </li>
              <li>
                <span className="font-medium">Lock permanently</span> — "Lock
                tag" makes it read-only forever. Simplest and free, but
                irreversible: double-check the URL is correct first, because a
                locked tag can never be changed.
              </li>
            </ul>
            <p className="mt-2 text-slate-500">
              This step happens on the tag itself in NFC Tools — it can't be done
              from a browser, so it's a one-time setup per tag.
            </p>
          </div>
        </div>
      )}
    </TeacherShell>
  );
}
