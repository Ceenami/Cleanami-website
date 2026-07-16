import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export interface TransactionalEmailProps {
  previewText: string;
  heading: string;
  greeting?: string;
  bodyLines: string[];
  ctaLabel?: string;
  ctaUrl?: string;
  footnote?: string;
}

/** Generic branded CleanNami transactional email used for lifecycle events. */
export default function TransactionalEmail({
  previewText,
  heading,
  greeting,
  bodyLines,
  ctaLabel,
  ctaUrl,
  footnote,
}: TransactionalEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{previewText}</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>CleanNami</Heading>
          <Section style={card}>
            <Heading style={h2}>{heading}</Heading>
            {greeting && <Text style={text}>{greeting}</Text>}
            {bodyLines.map((line, i) => (
              <Text key={i} style={text}>
                {line}
              </Text>
            ))}
            {ctaLabel && ctaUrl && (
              <Section style={{ textAlign: "center", marginTop: "24px" }}>
                <Link href={ctaUrl} style={button}>
                  {ctaLabel}
                </Link>
              </Section>
            )}
          </Section>
          {footnote && <Text style={foot}>{footnote}</Text>}
        </Container>
      </Body>
    </Html>
  );
}

const main = { backgroundColor: "#f4f4f5", fontFamily: "Arial, sans-serif" };
const container = { margin: "0 auto", padding: "24px", maxWidth: "560px" };
const h1 = { color: "#0d9488", fontSize: "24px", fontWeight: "bold" as const };
const h2 = { color: "#111827", fontSize: "20px", fontWeight: "bold" as const };
const card = {
  backgroundColor: "#ffffff",
  borderRadius: "12px",
  padding: "24px",
};
const text = { color: "#374151", fontSize: "15px", lineHeight: "1.6" };
const button = {
  backgroundColor: "#0d9488",
  color: "#ffffff",
  padding: "12px 24px",
  borderRadius: "8px",
  textDecoration: "none",
  fontWeight: "bold" as const,
};
const foot = { color: "#9ca3af", fontSize: "12px", marginTop: "16px" };
