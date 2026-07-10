import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

interface ResumeSetupEmailProps {
  resumeUrl: string;
  recipientName?: string;
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cleannami.ceenami.com";

export const ResumeSetupEmail = ({
  resumeUrl,
  recipientName,
}: ResumeSetupEmailProps) => {
  const previewText = "Your CleanNami setup call is booked + resume link";

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          {/* Logo */}
          <Section style={logoSection}>
            <Text style={logoText}>
              <span style={{ color: "#14b8a6" }}>Clean</span>Nami
            </Text>
          </Section>

          <Heading style={heading}>Your Setup Call is Booked! 🎉</Heading>

          <Text style={paragraph}>
            {recipientName ? `Hi ${recipientName},` : "Hi there,"}
          </Text>

          <Text style={paragraph}>
            Thanks for booking a setup call with me. I&apos;m looking forward to
            helping you get CleanNami configured perfectly for your property.
          </Text>

          {/* Google Meet info */}
          <Section style={infoBox}>
            <Text style={infoBoxText}>
              <strong>📅 Your Google Meet link</strong> is included in the
              calendar invite sent to your email. Check your calendar for the
              meeting details.
            </Text>
            <Text style={infoBoxText}>
              If you havent completed the booking you can do so from this link 
              <Link href="https://calendar.app.google/sFQGHgmBo2Jq6pww9" style={link}>Cleannami Booking</Link>
            </Text>
          </Section>

          <Hr style={hr} />

          {/* Resume section */}
          <Heading as="h2" style={subheading}>
            Continue Your Setup
          </Heading>

          <Text style={paragraph}>
            <strong>Nothing is lost.</strong> You will continue exactly where
            you left off. Click the button below to resume your setup whenever
            you&apos;re ready:
          </Text>

          <Section style={buttonContainer}>
            <Button style={button} href={resumeUrl}>
              Resume Your Setup
            </Button>
          </Section>

          <Text style={smallText}>
            Or copy and paste this link into your browser:
            <br />
            <Link href={resumeUrl} style={link}>
              {resumeUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          {/* Footer */}
          <Text style={footer}>
            Questions? Just reply to this email or call us directly.
            <br />
            <br />— Ceenami, Founder of CleanNami
          </Text>

          <Text style={footerSmall}>
            CleanNami · Vacation Rental Turnover Service
            <br />
            <Link href={baseUrl} style={link}>
              {baseUrl}
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
};

// Styles
const main = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  maxWidth: "560px",
  borderRadius: "8px",
};

const logoSection = {
  textAlign: "center" as const,
  marginBottom: "32px",
};

const logoText = {
  fontSize: "28px",
  fontWeight: "800",
  color: "#14b8a6",
  margin: "0",
};

const heading = {
  color: "#1f2937",
  fontSize: "24px",
  fontWeight: "700",
  textAlign: "center" as const,
  margin: "0 0 24px",
};

const subheading = {
  color: "#1f2937",
  fontSize: "18px",
  fontWeight: "600",
  margin: "24px 0 16px",
};

const paragraph = {
  color: "#4b5563",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "16px 0",
};

const infoBox = {
  backgroundColor: "#f0fdfa",
  border: "1px solid #99f6e4",
  borderRadius: "8px",
  padding: "16px 20px",
  margin: "24px 0",
};

const infoBoxText = {
  color: "#0f766e",
  fontSize: "14px",
  lineHeight: "22px",
  margin: "0",
};

const buttonContainer = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button = {
  backgroundColor: "#14b8a6",
  borderRadius: "8px",
  color: "#ffffff",
  fontSize: "16px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const hr = {
  borderColor: "#e5e7eb",
  margin: "32px 0",
};

const smallText = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "20px",
  textAlign: "center" as const,
};

const link = {
  color: "#14b8a6",
  textDecoration: "underline",
};

const footer = {
  color: "#4b5563",
  fontSize: "14px",
  lineHeight: "24px",
  marginTop: "32px",
};

const footerSmall = {
  color: "#9ca3af",
  fontSize: "12px",
  lineHeight: "20px",
  marginTop: "24px",
  textAlign: "center" as const,
};

export default ResumeSetupEmail;