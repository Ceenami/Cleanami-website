export default function page() {
  return (
    <div className="container mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">Employee Tracking</h1>
      
      <div className="w-full rounded-lg overflow-hidden border shadow-sm">
        <iframe
          className="w-full h-[calc(100vh-250px)] min-h-[400px]"
          style={{ border: 0 }}
          src="https://www.followmee.com/maps.aspx?key=3ae797255308f8a288a3b309f161f344&username=king2396&type=2&deviceid=12857663&function=currentfordevice"
          title="Employee Tracking Map"
          loading="lazy"
          allowFullScreen
        />
      </div>
    </div>
  );
}
