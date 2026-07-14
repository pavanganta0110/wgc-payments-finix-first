import { finixClient } from "../src/lib/finix/client";
import * as dotenv from "dotenv";
dotenv.config();

async function checkAndCreateFeeProfiles() {
  console.log("Checking for fee profiles...");
  
  // We need to fetch profiles, but wait, finixClient uses fetchApi which we can use
  // The fetchApi is private, let's use listTransfers as a proxy? No, fee_profiles endpoint
  const url = `${process.env.FINIX_BASE_URL}/fee_profiles`;
  const username = process.env.FINIX_USERNAME;
  const password = process.env.FINIX_PASSWORD;
  const authHeader = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  
  const res = await fetch(url, {
    headers: {
      "Authorization": authHeader,
      "Accept": "application/hal+json",
      "Finix-Version": "2022-02-01"
    }
  });
  
  const data = await res.json();
  const profiles = data._embedded?.fee_profiles || [];
  
  let zeroProfile = null;
  let orgPaidProfile = null;
  
  for (const profile of profiles) {
    const isZero = 
      profile.basis_points === 0 &&
      profile.fixed_fee === 0 &&
      profile.ach_basis_points === 0 &&
      profile.ach_fixed_fee === 0 &&
      (profile.american_express_basis_points === 0 || profile.american_express_basis_points === null) &&
      (profile.american_express_fixed_fee === 0 || profile.american_express_fixed_fee === null) &&
      profile.charge_interchange === false &&
      profile.charge_dues_assessments === false;
      
    const isOrgPaid = 
      profile.basis_points === 230 &&
      profile.fixed_fee === 30 &&
      profile.ach_basis_points === 0 &&
      profile.ach_fixed_fee === 25 &&
      profile.american_express_basis_points === 350 &&
      profile.american_express_fixed_fee === 30 &&
      profile.charge_interchange === false &&
      profile.charge_dues_assessments === false;
      
    if (isZero && !zeroProfile) zeroProfile = profile;
    if (isOrgPaid && !orgPaidProfile) orgPaidProfile = profile;
  }
  
  if (!zeroProfile) {
    console.log("Creating ZERO fee profile...");
    const createRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Finix-Version": "2022-02-01"
      },
      body: JSON.stringify({
        basis_points: 0,
        fixed_fee: 0,
        ach_basis_points: 0,
        ach_fixed_fee: 0,
        american_express_basis_points: 0,
        american_express_fixed_fee: 0,
        charge_interchange: false,
        charge_dues_assessments: false
      })
    });
    zeroProfile = await createRes.json();
    console.log("Created Zero Profile:", zeroProfile.id);
  } else {
    console.log("Found existing Zero Profile:", zeroProfile.id);
  }
  
  if (!orgPaidProfile) {
    console.log("Creating ORG-PAID fee profile...");
    const createRes = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
        "Finix-Version": "2022-02-01"
      },
      body: JSON.stringify({
        basis_points: 230,
        fixed_fee: 30,
        ach_basis_points: 0,
        ach_fixed_fee: 25,
        american_express_basis_points: 350,
        american_express_fixed_fee: 30,
        charge_interchange: false,
        charge_dues_assessments: false
      })
    });
    orgPaidProfile = await createRes.json();
    console.log("Created Org-Paid Profile:", orgPaidProfile.id);
  } else {
    console.log("Found existing Org-Paid Profile:", orgPaidProfile.id);
  }

  console.log("\n--- RESULT ---");
  console.log("WGC_DONOR_COVERED_ZERO_FEE_PROFILE_ID=" + zeroProfile.id);
  console.log("WGC_ORGANIZATION_PAID_FEE_PROFILE_ID=" + orgPaidProfile.id);
  
  console.log("\nZERO PROFILE DUMP:");
  console.log(JSON.stringify(zeroProfile, null, 2));
  console.log("\nORG-PAID PROFILE DUMP:");
  console.log(JSON.stringify(orgPaidProfile, null, 2));
}

checkAndCreateFeeProfiles().catch(console.error);
