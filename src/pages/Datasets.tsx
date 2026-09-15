import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Database,
  Download,
  Loader2,
  Plus,
  Trash2,
  Images,
  Film,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type DatasetRow = {
  _id: Id<"datasets">;
  name: string;
  description?: string;
  entryCount?: number;
  createdAt: number;
  updatedAt: number;
};

type EntryRow = {
  _id: Id<"datasetEntries">;
  datasetId: Id<"datasets">;
  videoId: Id<"videos">;
  caption?: string;
  style?: string;
  camera?: string;
  motion?: string;
  lighting?: string;
  subject?: string;
  environment?: string;
  tags?: string[];
  durationSeconds?: number;
  resolution?: string;
  model?: string;
  prompt?: string;
  frameSpec?: { fps: number; maxFrames: number };
  frameStatus?: string;
  frameStorageIds?: Id<"_storage">[];
  frameError?: string;
  createdAt: number;
};

export default function Datasets() {
  const datasets = useQuery(api.datasets.listDatasets) as DatasetRow[] | undefined;
  const createDataset = useMutation(api.datasets.createDataset);
  const deleteDataset = useMutation(api.datasets.deleteDataset);
  const [openId, setOpenId] = useState<Id<"datasets"> | null>(null);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  if (datasets === undefined) {
    return (
      <div className="flex items-center justify-center py-40 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> loading datasets…
      </div>
    );
  }

  const create = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createDataset({ name: newName.trim() });
      toast(`Dataset “${newName.trim()}” created.`);
      setNewName("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create dataset.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Datasets</h1>
        <p className="text-sm text-muted-foreground">
          Curated clips with caption + training metadata, ready for future LoRA /
          adapter experiments. Metadata only — media is never duplicated.
        </p>
      </div>

      {/* Create */}
      <div className="mt-6 flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New dataset name — e.g. wolfhustler product shots"
          className="max-w-sm"
        />
        <Button
          className="cursor-pointer gap-1"
          disabled={!newName.trim() || creating}
          onClick={() => void create()}
        >
          {creating ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Create dataset
        </Button>
      </div>

      {/* List */}
      {datasets.length === 0 ? (
        <div className="mt-10 flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
          <Database className="size-5" />
          No datasets yet. Add completed clips to a dataset from the Library.
        </div>
      ) : (
        <div className="mt-8 flex flex-col divide-y divide-border/60 rounded-lg border border-border/70">
          {datasets.map((d) => (
            <div key={d._id} className="flex items-center gap-4 px-4 py-4">
              <Database className="size-4 shrink-0 text-muted-foreground" />
              <button
                className="min-w-0 flex-1 cursor-pointer text-left"
                onClick={() => setOpenId(d._id)}
              >
                <p className="truncate text-sm font-medium">{d.name}</p>
                <p className="text-[11px] text-muted-foreground">
                  {d.entryCount ?? 0} entr{d.entryCount === 1 ? "y" : "ies"}
                  {d.description ? ` · ${d.description}` : ""}
                </p>
              </button>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer gap-1 text-muted-foreground"
                onClick={() => setOpenId(d._id)}
              >
                <Film className="size-4" /> Entries
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="cursor-pointer gap-1 text-muted-foreground"
                onClick={() => {
                  void deleteDataset({ id: d._id });
                  toast("Dataset deleted (library videos are untouched).");
                }}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {openId && <DatasetDetail datasetId={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function DatasetDetail({ datasetId, onClose }: { datasetId: Id<"datasets">; onClose: () => void }) {
  const data = useQuery(api.datasets.getDataset, { id: datasetId }) as
    | { dataset: DatasetRow; entries: EntryRow[] }
    | undefined;
  const updateEntryMetadata = useMutation(api.datasets.updateEntryMetadata);
  const removeEntry = useMutation(api.datasets.removeEntry);
  const setEntryFrameSpec = useMutation(api.datasets.setEntryFrameSpec);
  const [editing, setEditing] = useState<EntryRow | null>(null);

  const exportMetadata = () => {
    if (!data) return;
    const payload = {
      dataset: { name: data.dataset.name, description: data.dataset.description },
      entries: data.entries.map((e) => ({
        video: `clip_${e._id.slice(-8)}.mp4`,
        caption: e.caption ?? e.prompt ?? "",
        style: e.style,
        camera: e.camera,
        motion: e.motion,
        lighting: e.lighting,
        subject: e.subject,
        environment: e.environment,
        tags: e.tags ?? [],
        duration: e.durationSeconds,
        resolution: e.resolution,
        model: e.model,
        prompt: e.prompt,
        frameSpec: e.frameSpec,
        frameStatus: e.frameStatus,
      })),
      note: "Video and frame files live in the app's storage and can be downloaded individually. This JSON is the metadata sidecar for future training.",
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dataset-${data.dataset.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-metadata.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Metadata JSON downloaded.");
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center justify-between tracking-tight">
            <span>{data?.dataset.name ?? "Dataset"}</span>
            <Button
              variant="outline"
              size="sm"
              className="cursor-pointer gap-1"
              onClick={exportMetadata}
            >
              <Download className="size-4" /> Export metadata JSON
            </Button>
          </DialogTitle>
        </DialogHeader>

        {!data ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="mr-2 size-4 animate-spin" /> loading entries…
          </div>
        ) : data.entries.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No entries yet — add clips from the Library.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-border/60">
            {data.entries.map((e) => (
              <EntryRowItem
                key={e._id}
                e={e}
                onEdit={() => setEditing(e)}
                onRemove={() =>
                  void removeEntry({ id: e._id }).then(() =>
                    toast("Entry removed (the library video is untouched)."),
                  )
                }
                onQueueFrames={(fps, max) =>
                  void setEntryFrameSpec({ id: e._id, fps, maxFrames: max }).then(() =>
                    toast("Frame extraction queued for the worker."),
                  )
                }
              />
            ))}
          </div>
        )}

        {editing && (
          <MetadataEditor
            entry={editing}
            onClose={() => setEditing(null)}
            onSave={async (fields) => {
              await updateEntryMetadata({ id: editing._id, ...fields });
              toast("Metadata saved.");
              setEditing(null);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const META_FIELDS = [
  { key: "style", label: "Style", placeholder: "cinematic" },
  { key: "camera", label: "Camera", placeholder: "drone / push-in / orbit" },
  { key: "motion", label: "Motion", placeholder: "forward / handheld / static" },
  { key: "lighting", label: "Lighting", placeholder: "night / soft / dramatic" },
  { key: "subject", label: "Subject", placeholder: "leather jacket product" },
  { key: "environment", label: "Environment", placeholder: "studio / city" },
] as const;

function EntryRowItem({
  e,
  onEdit,
  onRemove,
  onQueueFrames,
}: {
  e: EntryRow;
  onEdit: () => void;
  onRemove: () => void;
  onQueueFrames: (fps: number, max: number) => void;
}) {
  const [fps, setFps] = useState("4");
  const [maxFrames, setMaxFrames] = useState("32");
  const frameStatus = e.frameStatus ?? "none";

  return (
    <div className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-3">
        <Images className="size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-sm">
          {e.caption ?? e.prompt ?? "Untitled entry"}
        </p>
        <Badge variant="outline" className="shrink-0 font-normal">
          frame: {frameStatus}
        </Badge>
        <Button variant="ghost" size="sm" className="cursor-pointer" onClick={onEdit}>
          Edit metadata
        </Button>
        <Button variant="ghost" size="sm" className="cursor-pointer text-destructive" onClick={onRemove}>
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <span>{e.durationSeconds ?? "?"}s · {e.resolution ?? "?"} · {e.model ?? "?"}</span>
        <Separator orientation="vertical" className="h-3" />
        {frameStatus === "ready" ? (
          <span>{e.frameStorageIds?.length ?? 0} frames extracted</span>
        ) : frameStatus === "queued" || frameStatus === "extracting" ? (
          <span className="flex items-center gap-1">
            <Loader2 className="size-3 animate-spin" /> waiting for worker
          </span>
        ) : (
          <>
            <input
              value={fps}
              onChange={(ev) => setFps(ev.target.value.replace(/[^0-9.]/g, ""))}
              className="w-12 rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-center font-mono"
              aria-label="frames per second"
            />
            <span>fps</span>
            <input
              value={maxFrames}
              onChange={(ev) => setMaxFrames(ev.target.value.replace(/[^0-9]/g, ""))}
              className="w-14 rounded border border-border/70 bg-transparent px-1.5 py-0.5 text-center font-mono"
              aria-label="max frames"
            />
            <span>frames max</span>
            <Button
              variant="outline"
              size="sm"
              className="h-6 cursor-pointer text-[11px]"
              onClick={() => onQueueFrames(Number(fps) || 4, Number(maxFrames) || 32)}
            >
              Queue extraction
            </Button>
          </>
        )}
        {e.frameError && <span className="text-destructive">{e.frameError}</span>}
      </div>
    </div>
  );
}

function MetadataEditor({
  entry,
  onClose,
  onSave,
}: {
  entry: EntryRow;
  onClose: () => void;
  onSave: (fields: Record<string, string | string[] | undefined>) => Promise<void>;
}) {
  const [caption, setCaption] = useState(entry.caption ?? "");
  const [tags, setTags] = useState((entry.tags ?? []).join(", "));
  const [fields, setFields] = useState<Record<string, string>>(
    Object.fromEntries(META_FIELDS.map((f) => [f.key, (entry as any)[f.key] ?? ""])),
  );

  return (
    <div className="mt-2 rounded-lg border border-border/70 p-4">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Caption
          </Label>
          <Textarea
            value={caption}
            onChange={(ev) => setCaption(ev.target.value)}
            rows={2}
            placeholder="cinematic drone shot of a futuristic city at night"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {META_FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-1">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                {f.label}
              </Label>
              <Input
                value={fields[f.key]}
                onChange={(ev) => setFields((p) => ({ ...p, [f.key]: ev.target.value }))}
                placeholder={f.placeholder}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs uppercase tracking-widest text-muted-foreground">
            Tags (comma separated)
          </Label>
          <Input value={tags} onChange={(ev) => setTags(ev.target.value)} placeholder="dark, luxury, product" />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" className="cursor-pointer" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            className="cursor-pointer"
            onClick={() =>
              void onSave({
                caption: caption || undefined,
                tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
                ...Object.fromEntries(
                  META_FIELDS.map((f) => [f.key, fields[f.key] || undefined]),
                ),
              })
            }
          >
            Save metadata
          </Button>
        </div>
      </div>
    </div>
  );
}
