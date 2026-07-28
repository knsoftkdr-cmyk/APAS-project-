import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Store, Upload } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { toast } from "sonner";
import {
  getMarketplaceCategories,
  getBrowseListings,
  getMyListings,
  createListing,
  publishListing,
  uploadListingFile,
  acquireListing,
  type MarketplaceContentType,
} from "@/lib/marketplace";

const CONTENT_TYPES: { value: MarketplaceContentType; label: string }[] = [
  { value: "lesson_plan", label: "Lesson Plan" },
  { value: "worksheet", label: "Worksheet" },
  { value: "assessment", label: "Assessment" },
  { value: "question_bank", label: "Question Bank" },
  { value: "ai_prompt", label: "AI Prompt" },
  { value: "digital_content", label: "Digital Content" },
  { value: "course", label: "Course" },
  { value: "template", label: "Template" },
  { value: "resource", label: "Resource" },
  { value: "third_party_app", label: "Third-Party App" },
];

export default function Marketplace() {
  const { user, profile } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("browse");

  const { data: categories } = useQuery({
    queryKey: ["marketplace-categories"],
    queryFn: getMarketplaceCategories,
  });

  const { data: browseListings, isLoading: browseLoading } = useQuery({
    queryKey: ["marketplace-browse"],
    queryFn: () => getBrowseListings(),
  });

  const acquireMutation = useMutation({
    mutationFn: (listingId: string) =>
      acquireListing(listingId, user!.id, profile?.school_id ?? null),
    onSuccess: () => {
      toast.success("Added to your listings");
    },
    onError: () => {
      toast.error("Failed to acquire (you may already have this)");
    },
  });

  const { data: myListings, isLoading: myListingsLoading } = useQuery({
    queryKey: ["marketplace-my-listings", user?.id],
    queryFn: () => getMyListings(user!.id),
    enabled: !!user?.id,
  });

  const publishMutation = useMutation({
    mutationFn: (listingId: string) => publishListing(listingId),
    onSuccess: () => {
      toast.success("Listing published");
      queryClient.invalidateQueries({ queryKey: ["marketplace-my-listings"] });
      queryClient.invalidateQueries({ queryKey: ["marketplace-browse"] });
    },
  });

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [contentType, setContentType] = useState<MarketplaceContentType>("lesson_plan");
  const [categoryId, setCategoryId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);

  const createMutation = useMutation({
    mutationFn: async () => {
      const listing = await createListing({
        publisherId: user!.id,
        publisherSchoolId: profile?.school_id ?? null,
        categoryId: categoryId || null,
        contentType,
        title,
        description,
        visibility: "school_only",
      });
      if (file) {
        await uploadListingFile(file, listing.id);
      }
      return listing;
    },
    onSuccess: () => {
      toast.success("Draft created. Publish it from 'My Listings' when ready.");
      setTitle("");
      setDescription("");
      setFile(null);
      queryClient.invalidateQueries({ queryKey: ["marketplace-my-listings"] });
      setTab("my-listings");
    },
    onError: () => toast.error("Failed to create listing"),
  });

  return (
    <AppLayout>
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Store className="h-5 w-5 text-indigo-600" />
        <h1 className="text-xl font-semibold">Marketplace</h1>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="browse">Browse</TabsTrigger>
          <TabsTrigger value="my-listings">My Listings</TabsTrigger>
          <TabsTrigger value="publish">Publish New</TabsTrigger>
        </TabsList>

        <TabsContent value="browse" className="space-y-3 mt-4">
          {browseLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : browseListings && browseListings.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {browseListings.map((l) => (
                <Card key={l.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      {l.title}
                      <Badge variant="secondary">{l.content_type.replace("_", " ")}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground line-clamp-3">{l.description}</p>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => acquireMutation.mutate(l.id)}
                      disabled={acquireMutation.isPending}
                    >
                      Get for free
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No published listings yet.</p>
          )}
        </TabsContent>

        <TabsContent value="my-listings" className="space-y-3 mt-4">
          {myListingsLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : myListings && myListings.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {myListings.map((l) => (
                <Card key={l.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      {l.title}
                      <Badge variant={l.status === "published" ? "default" : "secondary"}>
                        {l.status}
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="text-xs text-muted-foreground line-clamp-3">{l.description}</p>
                    {l.status === "draft" && (
                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => publishMutation.mutate(l.id)}
                        disabled={publishMutation.isPending}
                      >
                        Publish
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">You have not published anything yet.</p>
          )}
        </TabsContent>

        <TabsContent value="publish" className="mt-4">
          <Card className="max-w-xl">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Upload className="h-4 w-4" /> Publish New Listing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Title</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Class 6 Fractions Worksheet Pack" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Description</label>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Content Type</label>
                <select
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value as MarketplaceContentType)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  {CONTENT_TYPES.map((ct) => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                >
                  <option value="">Uncategorized</option>
                  {(categories ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">File (optional)</label>
                <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={!title.trim() || createMutation.isPending}
                className="bg-indigo-600 hover:bg-indigo-700"
              >
                {createMutation.isPending ? "Saving..." : "Save as Draft"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  </AppLayout>
  );
}