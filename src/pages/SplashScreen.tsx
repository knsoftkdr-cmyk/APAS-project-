import apasLogo from "@/assets/APAS-logo.png";

export default function SplashScreen() {
  return (
    <div className="h-screen flex flex-col items-center justify-center bg-white">
      <img
        src={apasLogo}
        alt="APAS"
        className="w-32 h-32 animate-[zoomIn_1.5s_ease-in-out]"
      />
    </div>
  );
}