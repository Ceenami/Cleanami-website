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

interface CustomerPortalEmailProps {
  loginUrl: string;
  recipientName?: string;
  isNewUser?: boolean;
}

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://cleannami.ceenami.com";

export const CustomerPortalEmail = ({
  loginUrl,
  recipientName,
  isNewUser = true,
}: CustomerPortalEmailProps) => {
  const previewText = "Your CleanNami customer portal is ready";

  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Section style={logoSection}>
            <Text style={logoText}>
              <span style={{ color: "#14b8a6" }}>Clean</span>Nami
            </Text>
          </Section>

          <Heading style={heading}>Your Portal Is Ready</Heading>

          <Text style={paragraph}>
            {recipientName ? `Hi ${recipientName},` : "Hi there,"}
          </Text>

          <Text style={paragraph}>
            Your subscription is active. Use the button below to sign in to your
            customer dashboard and manage your turnovers.
          </Text>

          <Section style={buttonContainer}>
            <Button style={button} href={loginUrl}>
              {isNewUser ? "Set up your login" : "Sign in to your portal"}
            </Button>
          </Section>

          <Text style={smallText}>
            Or copy and paste this link into your browser:
            <br />
            <Link href={loginUrl} style={link}>
              {loginUrl}
            </Link>
          </Text>

          <Hr style={hr} />

          <Text style={footer}>
            {isNewUser
              ? "This link lets you set a password or sign in with a magic link. You can also use /sign-in anytime."
              : "This magic link expires soon. You can always sign in at /sign-in with your email."}
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

const paragraph = {
  color: "#4b5563",
  fontSize: "16px",
  lineHeight: "26px",
  margin: "16px 0",
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

export default CustomerPortalEmail;
