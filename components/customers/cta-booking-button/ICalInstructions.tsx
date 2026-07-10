

export const ICalInstructions = () => {
  return (
    <div className="max-w-xl mx-auto p-4 md:p-6 bg-white shadow-lg rounded-xl">
      <div className="p-4 mb-6 bg-blue-50 border-l-4 border-brand rounded-md">
        <p className="text-sm text-gray-700 mb-3">
          Where do I find this? The iCal/ICS link allows for a read-only
          subscription to your calendar.
        </p>


<a href="https://help.vrbo.com/articles/Export-your-reservation-calendar" target="_blank" rel="noopener noreferrer">
<h4 className="font-bold text-base underline text-brand mt-2">
  Vrbo Help: How to Export Your Reservation Calendar

</h4>
</a>

<a href="https://www.airbnb.ca/help/article/99" target="_blank" rel="noopener noreferrer">
<h4 className="font-bold text-base underline text-brand mt-2">
  Airbnb Help: How to Import/Export Your Calendar
</h4>
</a>

         
        


        <h4 className="font-bold text-base text-gray-800 mt-2">
          Google Calendar (Desktop Recommended)
        </h4>
        <ol className="list-decimal list-inside text-sm text-gray-600 ml-4 mb-3">
          <li>
            Go to Google Calendar, hover over the calendar, and click the
            three dots.
          </li>
          <li>Select Settings and sharing.</li>
          <li>Scroll to the Integrate calendar section.</li>
          <li>Copy the link in the Secret address in iCal format field.</li>
        </ol>

        <h4 className="font-bold text-base text-gray-800 mt-3">
          Apple Calendar (iCloud)
        </h4>
        <ol className="list-decimal list-inside text-sm text-gray-600 ml-4 mb-3">
          <li>
            Go to{" "}
            <a
              href="https://www.icloud.com/calendar/"
              target="_blank"
              className="text-blue-600 underline"
            >
              iCloud.com Calendar
            </a>
            .
          </li>
          <li>Click the Share Calendar icon next to the calendar name.</li>
          <li>
            Check the Public Calendar box and copy the generated
            webcal:// link.
          </li>
        </ol>

        <h4 className="font-bold text-base text-gray-800 mt-3">
          Outlook.com / Office 365
        </h4>
        <ol className="list-decimal list-inside text-sm text-gray-600 ml-4">
          <li>Go to your Outlook Calendar settings Shared calendars.</li>
          <li>
            Under Publish a calendar, select the calendar and choose Can
            view all details.
          </li>
          <li>Click Publish, then copy the ICS link.</li>
        </ol>
      </div>
    </div>
  );
};
