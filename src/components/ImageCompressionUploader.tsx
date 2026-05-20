import { useState, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2, CheckCircle2, AlertCircle, Image as ImageIcon } from "lucide-react";

interface CompressionLog {
  id: string;
  original_filename: string;
  original_size_bytes: number;
  compressed_size_bytes: number;
  compression_ratio: number;
  status: string;
  created_at: string;
  mime_type: string;
}

export const ImageCompressionUploader = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [quality, setQuality] = useState(80);
  const [logs, setLogs] = useState<CompressionLog[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadStats = async () => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-compression-service`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
          },
          body: JSON.stringify({
            action: "get_compression_stats",
            days: 30,
          }),
        }
      );

      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setStats(data);
      setLogs(data.logs || []);
    } catch (e) {
      console.error("Error loading stats:", e);
    } finally {
      setLoading(false);
    }
  };

  useState(() => {
    loadStats();
  }, []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }

    try {
      setUploading(true);

      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/image-compression-service`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
            "user_id": user?.id,
            "X-Upload-Type": "multipart",
          },
          body: JSON.stringify({
            action: "compress_upload",
            filename: file.name,
            quality,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Upload failed");
      }

      const result = await response.json();
      toast.success(
        `Compressed! ${result.compression_ratio}% smaller (${formatBytes(result.original_size_bytes)} → ${formatBytes(result.compressed_size_bytes)})`
      );
      loadStats();
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e) {
      console.error("Upload error:", e);
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload & Compress Images</CardTitle>
          <CardDescription>Reduce image size automatically while maintaining quality</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Quality Slider */}
          <div>
            <label className="text-sm font-medium">Compression Quality: {quality}%</label>
            <input
              type="range"
              min="40"
              max="100"
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value))}
              className="w-full mt-2"
              disabled={uploading}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Lower = smaller files (40-60%), Medium = balanced (70-80%), Higher = better quality (90-100%)
            </p>
          </div>

          {/* File Input */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              disabled={uploading}
              className="hidden"
            />
            <Button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="w-full"
              size="lg"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Compressing...
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Select Image to Compress
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Total Compressed</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total_compressed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Bytes Saved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatBytes(stats.total_bytes_saved)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Avg Compression</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.avg_compression_ratio}%</div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Upload History */}
      <Card>
        <CardHeader>
          <CardTitle>Compression History</CardTitle>
          <CardDescription>Your recent image uploads and compressions</CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <ImageIcon className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No images uploaded yet</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Filename</TableHead>
                    <TableHead>Original Size</TableHead>
                    <TableHead>Compressed Size</TableHead>
                    <TableHead>Compression Ratio</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="font-medium text-sm">{log.original_filename}</TableCell>
                      <TableCell>{formatBytes(log.original_size_bytes)}</TableCell>
                      <TableCell>{formatBytes(log.compressed_size_bytes || 0)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{log.compression_ratio || 0}%</Badge>
                      </TableCell>
                      <TableCell>
                        {log.status === "compressed" ? (
                          <Badge className="gap-1 bg-green-50 text-green-700 border-green-200">
                            <CheckCircle2 className="h-3 w-3" /> Compressed
                          </Badge>
                        ) : log.status === "failed" ? (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" /> Failed
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {new Date(log.created_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
