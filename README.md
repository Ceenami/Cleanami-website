

## Getting Started

### Create admin account
  - sign up and create an acount
  - find your auth id
  - replace the id in the example with yours
  - run this command
  ```sql
    UPDATE auth.users
    SET raw_user_meta_data = raw_user_meta_data || '{"role": "super_admin"}'::jsonb
    WHERE id = '0c8fd1d5-5472-4e35-8e98-7b743b415ad6';

    UPDATE users
    SET role = 'super_admin'
    WHERE supabase_user_id = '0c8fd1d5-5472-4e35-8e98-7b743b415ad6';
  ```

The admin dashboards are not complete but enough is done to see
what you data.

Full documentation is in `docs` folder.

- full payment process iscomplete from collecting payments from customers
  automated nightly preauths, completeing the payment process, paying cleaners.
- To set the price create csv files and upload them in the dashboard.
  examples are in `pricing_data` folder.

First, run the development server:

- Create account on `cron-job.org` to create cron jobs
- Create a secret key for cron jobs
- generate api key for app to hit `api/jobs/complete-and-capture`
- Since the logo image is solarge i have to upload it
  to an image hosting site. I used `uploadthing.com` its free.
  Where ever you choose to host it just grab the image link and
  past it in `lib/constants/index.ts` with the `logo` variable.

- Fill in the .env variables
  - google maps and places (one api key)
  - supabase
  - stripe

the database schema is in `@/db/schemas/`

```bash
# install the dependencies
pnpm i
# generate the drizzle schemas
pnpm drizzle-kit generate
# migrate the dizzle schemas to the database
pnpm drizzle-kit migrate

npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```
Buckets dont delete on cascade
Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Pricing Service
`@/lib/services/pricing.service.ts`

this is where to change any of the pricing data.
this is used in the modal to display the correct values but ALSO most importantly used to verify prices before payment. Verifying before payment happens on the server in the `@/lib/actions/payment.actions.ts`.

I made it based of the spec sheet. I believe its accurate but should double check.

## Input Validations
`@/validations/booking-modal/`

These validations are are used to for error handling in development and on the client. There is also some types in there.

## Google Maps
`@/lib/google-maps/serviceArea`
This is where you would define the area you want google maps to validate addresses in.

use [GeoJson](http://geojson.io/) to make polygons for map coverage. You can have an array of pollygons to cover different areas.

`@/components/customers/cta-booking-button/AddressAutoComplete.tsx`
This is where the validation happens.

  - Listens toteh usersinput to find addresses
  - Returns auto completions to the user
  - Check to ensure google.maps.geometry is loaded before using it.
  - Loops the polygon coordinates and stops when it finds a match.
  - If a users address is outside the polygon coverage
    it will not allow the user to continue through the form until it get a valid entry.
  

  - Don't trust my selection for the required areas. You will have to manually make pollygons for the area you want to cover.
  - I added two other cities for testing.

## iCal Validations
`@/lib/actions/validate-ical.actions.ts`

  This is a server action to validate iCal URLS.
  It fetches the URL, parses the content, and checks for at least on event in teh future.

  - Fetches the calendar data from the provided URL.
  - Loops through all the calendar events.
  - Check if the events end date is in the future.
  - Stops when it finds a future event.
  - Also checks if the link is valid but contains no events.

## Payment
`@/lib/actions/payment.actions.ts`

Payments happen through server actions. When the customer inputs their card info and submits the payment server action runs.

  - Instantiates the pricing service, used to validate prices, dousnt trust what was sent from the browser.
  
  `createValidatedPaymentIntent()`
  - Recalculates the price
  - Compares the server price to the client price
    - this done to block price manipulation
  - Check if customer already exists in our database
  - Handle Stripe customer creation/retrieval
  - Customer exists in our DB, retrieve from Stripe
    - Update their info if needed
  - Check if customer exists in Stripe by email
    - Customer found in Stripe, use them
      - Update their info
  - Create new customer in Stripe
  - Construct the metadata object for the Payment Intent
  - Create the Stripe Payment Intent with the customer and metadata

## Onboarding
`@/lib/actions/onboarding.actions.ts`

 Main server action to complete the onboarding process after a successful payment.
 It validates the data and saves everything to the database in a single transaction.

  - Final, definitive validation on the server using the imported schema
  - Retrieve the payment intent to get the Stripe Customer ID
  - Perform all database operations within a single transaction for atomicity
  - Find or create the customer record with stripeCustomerId
  - Create the property record, mapping form fields to DB columns
  - If there are checklist files, upload them to Supabase Storage
  - Create the subscription record

## Payment Modal
`@/components/customers/cta-booking-button/`
  - Contains all the components for the modal
  
  ### TODO:
    - You need to test the modal and verify its accuracy in regards of pricing and products.
    - These can be easily modified if need be.

`@/components/customers/cta-booking-button/SignupModal.tsx`
  - The main entry point. this is what gets imported.
You can drop this button in anywhere and it will work.

The main pages for the modal are `Step1Customerinfo.tsx` to `Step8CustomerConfirmation.tsx`

  - Does not allow the customer to continue unless the required information is selected and verified.

`StepFeedback.tsx` is used for client side error handling, it provides helpful information about the error.

`PriceSummary.tsx` is the price summary that is talied throught the process so the user knows how much the service will come to.

`CheckoutForm.tsx` is the Stripe form used when the user gets to the checkout page.

`Step7Payment.tsx` this is where the payment happens

Even though this is a client component `createValidatedPaymentIntent(formData, ammountInCents)`
only runs on the server. The callbacks run on the client to inform the customer that their payment was succesful or not


## TODO: 
Custom Quote Required
Properties over 3,000 sq ft require a custom quote. Please continue and we will contact you with pricing.