export default function SchoolBusLoader() {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white">
      <h1 className="text-3xl font-bold text-blue-600 mb-8">
        Preparing Assessment...
      </h1>

        <div className="relative w-[320px] h-24 overflow-hidden">
            <div className="absolute bottom-5 w-full h-1 bg-gray-400"></div>

<div className="absolute right-0 bottom-4 text-4xl md:text-8xl">
  🏫
</div>

<div
  className="absolute bottom-1 md:bottom-2 animate-bus"
  style={{
    fontSize: window.innerWidth < 768 ? "20px" : "30px",
  }}
>
  🚌
</div>
        </div>

      <p className="mt-6 text-gray-600 text-lg animate-pulse">
        Taking you to today's assessment...
      </p>
    </div>
  );
}