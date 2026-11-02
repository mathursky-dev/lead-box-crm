export const IVR_PROVIDERS_UI = {
  exotel: {
    label: "Exotel", key: "API key", token: "API token", number: "ExoPhone (virtual number)",
    help: "Exotel dashboard → Settings → API: copy the Account SID, API key and API token. Use an ExoPhone from your account as the caller number.",
    hook: "For incoming calls: in your Exotel call flow add a Passthru applet (after Connect) with this URL. Click-to-call calls report here by themselves.",
  },
  knowlarity: {
    label: "Knowlarity", key: "API key (x-api-key)", token: "Authorization token", number: "SuperReceptionist number (k_number)",
    help: "Knowlarity → Settings → API: copy the x-api-key and Authorization token. The SR number is your virtual number.",
    hook: "Knowlarity → Settings → Webhooks (call end / post-call): paste this URL so every call and its recording comes to the CRM.",
  },
} as const;
