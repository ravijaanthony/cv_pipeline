import axios from "axios";

const RESEND_API_URL = "https://api.resend.com/emails";

const buildPlainTextEmail = (applicantName) => `Dear ${applicantName || "Applicant"},

Thank you for submitting your CV. We wanted to let you know that your CV is currently under review. We will get back to you soon with more information.

Best regards,
Company`;

const buildHtmlEmail = (applicantName) => `<p>Dear ${applicantName || "Applicant"},</p>
<p>Thank you for submitting your CV. We wanted to let you know that your CV is currently under review. We will get back to you soon with more information.</p>
<p>Best regards,<br />Company</p>`;

export const sendCandidateReviewEmail = async ({
    resendApiKey,
    resendFromEmail,
    resendReplyTo,
    candidateEmail,
    applicantName
}) => {
    const payload = {
        from: resendFromEmail,
        to: [candidateEmail],
        subject: "Your CV is Under Review",
        text: buildPlainTextEmail(applicantName),
        html: buildHtmlEmail(applicantName)
    };

    if (resendReplyTo) {
        payload.reply_to = resendReplyTo;
    }

    const response = await axios.post(RESEND_API_URL, payload, {
        headers: {
            Authorization: `Bearer ${resendApiKey}`,
            "Content-Type": "application/json"
        }
    });

    return response.data;
};
