import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

export const STATEMENT_DISCLAIMER =
  "This statement summarizes donations recorded by the organization during the selected year. It is provided for record-keeping purposes only and does not constitute tax advice. Donors should consult a qualified tax professional regarding their individual circumstances.";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica" },
  header: { marginBottom: 16, borderBottom: 1, borderBottomColor: "#e2e8f0", paddingBottom: 12 },
  orgName: { fontSize: 16, fontWeight: 700, marginBottom: 2 },
  title: { fontSize: 12, color: "#475569", marginTop: 4 },
  section: { marginBottom: 14 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6, color: "#0f172a" },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 3 },
  label: { color: "#64748b" },
  value: { fontWeight: 700 },
  table: { marginTop: 6 },
  tableHeaderRow: { flexDirection: "row", backgroundColor: "#f1f5f9", padding: 4, fontWeight: 700 },
  tableRow: { flexDirection: "row", padding: 4, borderBottom: 1, borderBottomColor: "#f1f5f9" },
  colDate: { width: "14%" },
  colRef: { width: "22%" },
  colFund: { width: "18%" },
  colGross: { width: "14%", textAlign: "right" },
  colAdj: { width: "16%", textAlign: "right" },
  colFinal: { width: "16%", textAlign: "right" },
  footer: { position: "absolute", bottom: 24, left: 36, right: 36, fontSize: 8, color: "#94a3b8" },
  disclaimer: { fontSize: 8, color: "#64748b", marginTop: 16, lineHeight: 1.4 },
  pageNumber: { position: "absolute", bottom: 24, right: 36, fontSize: 8, color: "#94a3b8" },
});

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format((cents || 0) / 100);
}

function formatDate(d: Date) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export interface StatementPdfProps {
  organizationName: string;
  organizationAddress: string | null;
  organizationEmail: string | null;
  organizationPhone: string | null;
  donorName: string;
  donorEmail: string | null;
  taxYear: number;
  donationCount: number;
  grossDonatedCents: number;
  refundedAmountCents: number;
  returnedAmountCents: number;
  recordedTotalCents: number;
  lines: {
    donationDate: Date;
    reference: string;
    fundName: string | null;
    grossAmountCents: number;
    refundedAmountCents: number;
    returnedAmountCents: number;
    finalRecordedAmountCents: number;
    paymentMethodLabel: string;
  }[];
  thankYouMessage: string;
  generatedAt: Date;
}

export function YearEndStatementPdf(props: StatementPdfProps) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.orgName}>{props.organizationName}</Text>
          {props.organizationAddress && <Text style={{ color: "#64748b" }}>{props.organizationAddress}</Text>}
          <Text style={{ color: "#64748b" }}>
            {[props.organizationEmail, props.organizationPhone].filter(Boolean).join(" · ")}
          </Text>
          <Text style={styles.title}>Year-End Donation Statement — {props.taxYear}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Donor</Text>
          <View style={styles.row}><Text style={styles.label}>Name</Text><Text style={styles.value}>{props.donorName}</Text></View>
          {props.donorEmail && <View style={styles.row}><Text style={styles.label}>Email</Text><Text style={styles.value}>{props.donorEmail}</Text></View>}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Donation Summary</Text>
          <View style={styles.row}><Text style={styles.label}>Number of Donations</Text><Text style={styles.value}>{props.donationCount}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Gross Donated</Text><Text style={styles.value}>{formatCents(props.grossDonatedCents)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Refunded</Text><Text style={styles.value}>{formatCents(props.refundedAmountCents)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>ACH Returned</Text><Text style={styles.value}>{formatCents(props.returnedAmountCents)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Recorded Annual Total</Text><Text style={styles.value}>{formatCents(props.recordedTotalCents)}</Text></View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Donation History</Text>
          <View style={styles.table}>
            <View style={styles.tableHeaderRow} fixed>
              <Text style={styles.colDate}>Date</Text>
              <Text style={styles.colRef}>Reference</Text>
              <Text style={styles.colFund}>Fund</Text>
              <Text style={styles.colGross}>Gross</Text>
              <Text style={styles.colAdj}>Adjustments</Text>
              <Text style={styles.colFinal}>Recorded</Text>
            </View>
            {props.lines.map((line, i) => (
              <View style={styles.tableRow} key={i} wrap={false}>
                <Text style={styles.colDate}>{formatDate(line.donationDate)}</Text>
                <Text style={styles.colRef}>{line.reference}</Text>
                <Text style={styles.colFund}>{line.fundName || "—"}</Text>
                <Text style={styles.colGross}>{formatCents(line.grossAmountCents)}</Text>
                <Text style={styles.colAdj}>
                  {line.refundedAmountCents + line.returnedAmountCents > 0
                    ? `-${formatCents(line.refundedAmountCents + line.returnedAmountCents)}`
                    : "—"}
                </Text>
                <Text style={styles.colFinal}>{formatCents(line.finalRecordedAmountCents)}</Text>
              </View>
            ))}
          </View>
        </View>

        {props.thankYouMessage && <Text style={{ marginTop: 8 }}>{props.thankYouMessage}</Text>}

        <Text style={styles.disclaimer}>{STATEMENT_DISCLAIMER}</Text>

        <Text style={styles.footer} fixed>
          Generated {formatDate(props.generatedAt)}
        </Text>
        <Text style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
