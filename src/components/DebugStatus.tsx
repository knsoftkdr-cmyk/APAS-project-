// This component is for debugging purposes
export const DebugStatus = () => {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  
  console.log("Debug Status:");
  console.log("- Supabase URL:", supabaseUrl ? "✓ Set" : "✗ Missing");
  console.log("- Supabase Key:", supabaseKey ? "✓ Set" : "✗ Missing");
  console.log("- Environment:", import.meta.env.MODE);
  
  return null; // Don't render anything, just log
};
