// Resolves what a Marketplace video listing actually plays: a YouTube link, a direct link, or an uploaded file.
// This is the lookup the Marketplace video card always did, extracted so the player, the teacher's question tool
// and the student's learning screen share it (same react-query key, so the signed URL is fetched once).
import { useQuery } from "@tanstack/react-query";
import { getListingFiles, getListingFileSignedUrl } from "@/lib/marketplace";

export function getYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}

export function isVideoFile(fileType: string | null | undefined): boolean {
  if (!fileType) return true; // legacy rows with no type were always videos
  const t = fileType.toLowerCase();
  return t.startsWith("video/") || ["mp4", "webm", "mov", "mkv", "avi", "m4v", "mpeg", "mpg", "ogv"].includes(t);
}

export interface ListingFile { fileType: string | null; name: string; viewUrl: string; downloadUrl: string }

export function useListingVideoSource(listing: { id: string; video_url: string | null }) {
  const { data: file, isLoading, isError, refetch } = useQuery({
    queryKey: ["marketplace-listing-file", listing.id],
    enabled: !listing.video_url,
    staleTime: 30 * 60 * 1000,
    retry: 1,                       // fail fast: a slow storage service should not leave a card on "Loading..." for ages
    retryDelay: 1500,
    queryFn: async (): Promise<ListingFile | null> => {
      const files = await getListingFiles(listing.id);
      if (files.length === 0) return null;
      const f = files[0];
      const name = f.storage_path.split("/").pop()?.replace(/^\d+-/, "") ?? "file";
      const [viewUrl, downloadUrl] = await Promise.all([
        getListingFileSignedUrl(f.storage_path),
        getListingFileSignedUrl(f.storage_path, name),
      ]);
      return { fileType: f.file_type, name, viewUrl, downloadUrl };
    },
  });
  const youTubeId = listing.video_url ? getYouTubeId(listing.video_url) : null;
  const src = youTubeId ? null : listing.video_url ?? (file && isVideoFile(file.fileType) ? file.viewUrl : null);
  return { file: file ?? null, isLoading, isError, refetch, youTubeId, src, isDocument: !listing.video_url && !!file && !isVideoFile(file.fileType) };
}
