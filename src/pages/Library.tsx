import { useQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Download,
  Heart,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Tags,
  Trash2,
  Film,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type VideoRow = {
  _id: Id<"videos">;
  type: string;
  title?: string;
  prompt: string;
  videoUrl?: string;
  videoStorageId?: Id<"_storage">;
  thumbnailStorageId?: Id<"_storage">;
  model: string;
  provider?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  status: string;
  errorMessage?: string;
  favorite?: boolean;
  tags?: string[];
  createdAt: number;
};

function timeAgo(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function Library() {
  const videos = useQuery(api.videos.listMyVideos) as VideoRow[] | undefined;
  const datasets = useQuery(api.datasets.listDatasets);
  const setVideoTitle = useMutation(api.videos.setVideoTitle);
  const setVideoTags = useMutation(api.videos.setVideoTags);
  const setVideoFavorite = useMutation(api.videos.setVideoFavorite);
  const deleteVideo = useMutation(api.videos.deleteVideo);
  const addVideoToDataset = useMutation(api.datasets.addVideoToDataset);
  const createDataset = useMutation(api.datasets.createDataset);

  const [playerVideo, setPlayerVideo] = useState<VideoRow | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<VideoRow | null>(null);
  const [editingTitle, setEditingTitle] = useState<Id<"videos"> | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [tagsVideo, setTagsVideo] = useState<VideoRow | null>(null);
  const [tagsDraft, setTagsDraft] = useState("");
  const [datasetTarget, setDatasetTarget] = useState<VideoRow | null>(null);
  const [newDatasetName, setNewDatasetName] = useState("");
  const [creatingDataset, setCreatingDataset] = useState(false);

  const download = async (v: VideoRow) => {
    if (!v.videoUrl && !v.videoStorageId) return;
    try {
      if (v.videoUrl) {
        const res = await fetch(v.videoUrl);
        if (!res.ok) throw new Error(`Download failed (${res.status}).`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `image-motion-${v._id.slice(-8)}.mp4`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } else if (v.videoStorageId) {
        window.open(`/api/storage?id=${v.videoStorageId}`, "_blank");
      }
    } catch {
      if (v.videoUrl) window.open(v.videoUrl, "_blank");
    }
    toast("Download started.");
  };

  const saveTitle = async () => {
    if (!editingTitle) return;
    try {
      await setVideoTitle({ id: editingTitle, title: titleDraft });
      toast("Title updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Rename failed.");
    }
    setEditingTitle(null);
  };

  const saveTags = async () => {
    if (!tagsVideo) return;
    try {
      await setVideoTags({
        id: tagsVideo._id,
        tags: tagsDraft.split(",").map((t) => t.trim()).filter(Boolean),
      });
      toast("Tags saved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Saving tags failed.");
    }
    setTagsVideo(null);
  };

  const addToDataset = async (datasetId: Id<"datasets">) => {
    if (!datasetTarget) return;
    try {
      await addVideoToDataset({ datasetId, videoId: datasetTarget._id });
      toast("Added to dataset.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add to dataset.");
    }
    setDatasetTarget(null);
  };

  const createAndAdd = async () => {
    if (!datasetTarget || !newDatasetName.trim()) return;
    setCreatingDataset(true);
    try {
      const datasetId = await createDataset({ name: newDatasetName });
      await addVideoToDataset({ datasetId, videoId: datasetTarget._id });
      toast(`Created “${newDatasetName.trim()}” and added the clip.`);
      setNewDatasetName("");
      setDatasetTarget(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create dataset.");
    } finally {
      setCreatingDataset(false);
    }
  };

  if (videos === undefined) {
    return (
      <div className="flex items-center justify-center py-40 text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" /> loading library…
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
        <p className="text-sm text-muted-foreground">
          {videos.length} clip{videos.length === 1 ? "" : "s"}. Nothing is deleted
          automatically — you decide what stays.
        </p>
      </div>

      {videos.length === 0 ? (
        <div className="mt-10 flex h-48 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/70 text-sm text-muted-foreground">
          <Film className="size-5" />
          No clips yet. Generate your first video from the Generate page.
        </div>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {videos.map((v) => (
            <LibraryCard
              key={v._id}
              v={v}
              onPlay={() => setPlayerVideo(v)}
              onDownload={() => void download(v)}
              onRename={() => {
                setEditingTitle(v._id);
                setTitleDraft(v.title ?? "");
              }}
              onTags={() => {
                setTagsVideo(v);
                setTagsDraft((v.tags ?? []).join(", "));
              }}
              onFavorite={() =>
                void setVideoFavorite({ id: v._id, favorite: !v.favorite })
              }
              onDelete={() => setConfirmDelete(v)}
              onDataset={() => setDatasetTarget(v)}
            />
          ))}
        </div>
      )}

      {/* Player dialog */}
      <Dialog open={!!playerVideo} onOpenChange={(o) => !o && setPlayerVideo(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="tracking-tight">
              {playerVideo?.title ?? playerVideo?.prompt.slice(0, 60)}
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              {playerVideo?.model} · {playerVideo?.durationSeconds ?? "?"}s ·{" "}
              {playerVideo?.aspectRatio ?? "?"} · seed {playerVideo?.seed ?? "—"}
            </DialogDescription>
          </DialogHeader>
          {playerVideo && (
            <PlayerDialogBody video={playerVideo} />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clip?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the video file, its thumbnail and any dataset
              entries that reference it. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) void deleteVideo({ id: confirmDelete._id });
                toast("Clip deleted.");
              }}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
          <Separator className="my-1 opacity-0" />
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename dialog */}
      <Dialog open={!!editingTitle} onOpenChange={(o) => !o && setEditingTitle(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Rename clip</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              placeholder="Clip title"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setEditingTitle(null)}>
                Cancel
              </Button>
              <Button size="sm" className="cursor-pointer" onClick={() => void saveTitle()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Tags dialog */}
      <Dialog open={!!tagsVideo} onOpenChange={(o) => !o && setTagsVideo(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Edit tags</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              value={tagsDraft}
              onChange={(e) => setTagsDraft(e.target.value)}
              placeholder="cinematic, dark, product — comma separated"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" className="cursor-pointer" onClick={() => setTagsVideo(null)}>
                Cancel
              </Button>
              <Button size="sm" className="cursor-pointer" onClick={() => void saveTags()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add to dataset dialog */}
      <Dialog open={!!datasetTarget} onOpenChange={(o) => !o && setDatasetTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="tracking-tight">Add to dataset</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            {datasets && datasets.length > 0 ? (
              <div className="flex flex-col gap-2">
                <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                  Existing datasets
                </Label>
                {datasets.map((d) => (
                  <button
                    key={d._id}
                    onClick={() => void addToDataset(d._id)}
                    className="flex cursor-pointer items-center justify-between rounded-md border border-border/70 px-3 py-2 text-sm hover:bg-accent/50"
                  >
                    <span>{d.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {d.entryCount ?? 0} entries
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No datasets yet.</p>
            )}
            <div className="flex flex-col gap-2">
              <Label className="text-xs uppercase tracking-widest text-muted-foreground">
                Or create a new one
              </Label>
              <div className="flex gap-2">
                <Input
                  value={newDatasetName}
                  onChange={(e) => setNewDatasetName(e.target.value)}
                  placeholder="e.g. wolfhustler — product shots"
                />
                <Button
                  size="sm"
                  className="cursor-pointer gap-1"
                  disabled={!newDatasetName.trim() || creatingDataset}
                  onClick={() => void createAndAdd()}
                >
                  {creatingDataset ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
                  Create
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PlayerDialogBody({ video }: { video: VideoRow }) {
  const storageUrl = useQuery(
    api.videos.getStorageUrl,
    video.videoStorageId ? { storageId: video.videoStorageId } : "skip",
  );
  const src = video.videoUrl ?? storageUrl ?? null;
  if (!src) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        File URL not available.
      </p>
    );
  }
  return (
    <video
      src={src}
      controls
      autoPlay
      loop
      muted
      playsInline
      className="w-full rounded-lg border border-border/70"
    />
  );
}

function LibraryCard({
  v,
  onPlay,
  onDownload,
  onRename,
  onTags,
  onFavorite,
  onDelete,
  onDataset,
}: {
  v: VideoRow;
  onPlay: () => void;
  onDownload: () => void;
  onRename: () => void;
  onTags: () => void;
  onFavorite: () => void;
  onDelete: () => void;
  onDataset: () => void;
}) {
  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border/70">
      <button
        onClick={onPlay}
        className="relative flex aspect-video cursor-pointer items-center justify-center bg-accent/30 hover:bg-accent/50"
      >
        {v.status === "completed" ? (
          <Film className="size-6 text-muted-foreground" />
        ) : (
          <span className="text-xs text-destructive">{v.status}</span>
        )}
        {v.favorite && (
          <Heart className="absolute right-2 top-2 size-4 fill-foreground text-foreground" />
        )}
        <span className="absolute bottom-2 left-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {v.durationSeconds ?? "?"}s · {v.aspectRatio ?? "?"}
        </span>
      </button>
      <div className="flex flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{v.title ?? v.prompt.slice(0, 48)}</p>
            <p className="text-[11px] text-muted-foreground">
              {timeAgo(v.createdAt)} · {v.model.split("/").slice(-1)[0]}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 cursor-pointer px-1.5">
                <MoreVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem className="cursor-pointer" onClick={onPlay}>
                Play
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={onDownload}>
                <Download className="mr-2 size-3.5" /> Download
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={onRename}>
                <Pencil className="mr-2 size-3.5" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={onTags}>
                <Tags className="mr-2 size-3.5" /> Tags
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={onFavorite}>
                <Heart className="mr-2 size-3.5" /> {v.favorite ? "Unfavorite" : "Favorite"}
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer" onClick={onDataset}>
                <Plus className="mr-2 size-3.5" /> Add to dataset
              </DropdownMenuItem>
              <DropdownMenuItem className="cursor-pointer text-destructive" onClick={onDelete}>
                <Trash2 className="mr-2 size-3.5" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {v.tags && v.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {v.tags.slice(0, 4).map((t) => (
              <Badge key={t} variant="outline" className="font-normal">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
