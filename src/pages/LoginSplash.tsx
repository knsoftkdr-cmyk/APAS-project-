import { useEffect, useState } from "react";
import apasLogo from "@/assets/APAS-logo.png";

export default function LoginSplash() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(timer);
          return 100;
        }
        return prev + 10;
      });
    }, 100);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white">
      <p className="mt-2 text-gray-500 text-bold">
        Loading your dashboard
      </p>

        <div className="flex gap-3 mt-4">
        <span className="w-4 h-4 bg-blue-600 rounded-full animate-bounce"></span>
        <span className="w-4 h-4 bg-blue-600 rounded-full animate-bounce [animation-delay:0.2s]"></span>
        <span className="w-4 h-4 bg-blue-600 rounded-full animate-bounce [animation-delay:0.4s]"></span>
        </div>

      <div className="w-72 h-3 bg-gray-200 rounded-full overflow-hidden mt-8">
        <div
          className="h-full bg-blue-600 transition-all duration-100"
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="mt-3 text-sm font-medium text-blue-600">
        {progress}%
      </p>
    </div>
  );
}