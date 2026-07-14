path = "src/pages/StudentElectives.tsx"
with open(path, "r") as f:
    content = f.read()

changes = []

old = '''  const handleChoose = async (electiveId: string) => {
    setActingOn(electiveId);
    try {
      const { data, error } = await supabase.functions.invoke("choose-elective", {
        body: { elective_id: electiveId },
      });
      if (error) throw error;
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success("Elective chosen!");
      queryClient.invalidateQueries({ queryKey: ["my-elective-choices"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to choose elective");
    } finally {
      setActingOn(null);
    }
  };'''

new = '''  const handleChoose = async (electiveId: string) => {
    setActingOn(electiveId);
    try {
      const { data, error } = await supabase.functions.invoke("choose-elective", {
        body: { elective_id: electiveId },
      });
      if (error) {
        // Supabase wraps non-2xx responses in a generic FunctionsHttpError whose
        // .message is just "Edge Function returned a non-2xx status code" — the
        // actual { error: "..." } body our function sends is on error.context,
        // which is the raw Response object and needs to be read/parsed explicitly.
        let serverMessage: string | null = null;
        try {
          const ctx = (error as any)?.context;
          if (ctx && typeof ctx.json === "function") {
            const body = await ctx.json();
            serverMessage = body?.error ?? null;
          }
        } catch {
          // response body wasn't JSON or already consumed — fall back below
        }
        toast.error(serverMessage ?? error.message ?? "Failed to choose elective");
        return;
      }
      if (data?.error) {
        toast.error(data.error);
        return;
      }
      toast.success("Elective chosen!");
      queryClient.invalidateQueries({ queryKey: ["my-elective-choices"] });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to choose elective");
    } finally {
      setActingOn(null);
    }
  };'''

if old in content:
    content = content.replace(old, new)
    changes.append("Patched handleChoose to surface real error message from response body")
elif "error.context" in content:
    changes.append("Already patched, skipping")
else:
    changes.append("WARNING: anchor not found, check manually")

with open(path, "w") as f:
    f.write(content)

print("\n".join(changes))
