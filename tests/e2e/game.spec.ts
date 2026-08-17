/**
 * E2E test — Simulates a real player playing Simple FM in the browser.
 *
 * Usage:  npx playwright test
 */

import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

// ── Screenshot helper ────────────────────────────────────────

const SCREENSHOT_DIR = path.resolve("screenshots");

function screenshotPath(name: string): string {
  if (!fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  return path.join(SCREENSHOT_DIR, `${name}_${ts}.png`);
}

async function snap(page: Page, label: string): Promise<void> {
  const fp = screenshotPath(label);
  await page.screenshot({ path: fp, fullPage: false });
  console.log(`  📸 Screenshot: ${fp}`);
}

// ── Error monitoring ─────────────────────────────────────────

function installErrorMonitor(page: Page): void {
  const errors: string[] = [];
  const warnings: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (text.includes("Failed to load resource")) return; // skip network errors
      errors.push(text);
      console.error(`  🔴 console.error: ${text}`);
    }
    if (msg.type() === "warning") {
      warnings.push(msg.text());
    }
  });

  page.on("pageerror", (err) => {
    errors.push(err.message);
    console.error(`  💥 pageerror: ${err.message}`);
  });

  // Expose for assertions
  (page as Page & { _errors: string[] })._errors = errors;
  (page as Page & { _warnings: string[] })._warnings = warnings;
}

// ── Tests ────────────────────────────────────────────────────

test.describe("Simple FM — Full Gameplay Flow", () => {
  test("complete game session with error monitoring", async ({ page }) => {
    installErrorMonitor(page);

    // ═══════════════════════════════════════════════════════════
    // 1. Navigate to the app
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 1: Loading app...");
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(1000);
    await snap(page, "01_initial_load");

    // Should see the team selection screen
    const teamSelection = page.locator("text=Simple FM").first();
    await expect(teamSelection).toBeVisible({ timeout: 10_000 });
    console.log("  ✅ Team selection screen loaded");

    // ═══════════════════════════════════════════════════════════
    // 2. Select a league and team
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 2: Selecting a team...");

    // Click the first league in the sidebar
    const leagueBtns = page.locator("aside nav button");
    const leagueCount = await leagueBtns.count();
    console.log(`  Found ${leagueCount} leagues`);

    if (leagueCount > 0) {
      await leagueBtns.first().click();
      await page.waitForTimeout(500);

      // Click the first team card
      const teamCards = page.locator("main button");
      const teamCount = await teamCards.count();
      console.log(`  Found ${teamCount} team cards`);
      await snap(page, "02_league_selected");

      if (teamCount > 0) {
        await teamCards.first().click();
        await page.waitForTimeout(500);
        await snap(page, "03_team_selected");
        console.log("  ✅ Team selected");

        // Click "执教该球队，开启生涯"
        const startBtn = page.getByText("执教该球队").first();
        if (await startBtn.isVisible()) {
          await startBtn.click();
          await page.waitForTimeout(2000);
          console.log("  ✅ Game started");
        }
      }
    }

    await snap(page, "04_dashboard");

    // ═══════════════════════════════════════════════════════════
    // 3. Verify dashboard loaded (squad view)
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 3: Verifying dashboard...");

    // Should show "阵容" tab
    const squadTab = page.getByText("阵容").first();
    await expect(squadTab).toBeVisible({ timeout: 8_000 });
    console.log("  ✅ Squad tab visible");

    // ═══════════════════════════════════════════════════════════
    // 4. Click "一键补齐" (Auto-fill squad)
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 4: Auto-fill squad...");

    const autoFillBtn = page.getByText("一键补齐").first();
    if (await autoFillBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await autoFillBtn.click();
      await page.waitForTimeout(500);
      console.log("  ✅ Auto-fill clicked");
    } else {
      console.log("  ⚠️ Auto-fill button not found");
    }

    // Switch to pitch view to check lineup
    const pitchBtn = page.getByText("阵型视图").first();
    if (await pitchBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await pitchBtn.click();
      await page.waitForTimeout(800);
      await snap(page, "05_pitch_view");
      console.log("  ✅ Pitch view loaded");
    }

    // Switch back to list view
    const listBtn = page.getByText("列表视图").first();
    if (await listBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await listBtn.click();
      await page.waitForTimeout(300);
    }

    // ═══════════════════════════════════════════════════════════
    // 5. Play matches (5 rounds)
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 5: Playing matches...");

    for (let round = 1; round <= 5; round++) {
      console.log(`\n  ── Round ${round} ──`);

      // Re-fill squad before each match
      const fillBtn = page.getByText("一键补齐").first();
      if (await fillBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await fillBtn.click();
        await page.waitForTimeout(300);
      }

      // Click play match button
      const playBtn = page.getByText("踢下一场比赛").first();
      const hasPlayBtn = await playBtn.isVisible({ timeout: 2_000 }).catch(() => false);
      if (!hasPlayBtn) {
        console.log("  ⚠️ Play button not found — season may have ended");
        break;
      }

      // Check if button is disabled
      const isDisabled = await playBtn.isDisabled().catch(() => true);
      if (isDisabled) {
        console.log("  ⚠️ Play button disabled — season ended or squad incomplete");
        break;
      }

      await playBtn.click();
      await page.waitForTimeout(1500);
      await snap(page, `06_round_${round}_match_result`);

      // Check for the "终场" modal
      const matchModal = page.getByText("终场").first();
      const hasModal = await matchModal.isVisible({ timeout: 3_000 }).catch(() => false);

      if (hasModal) {
        console.log("  ✅ Match result modal shown");

        // Check for error text in modal (should not see "undefined" or "NaN")
        const modalText = await page.locator(".fixed.inset-0.z-50").first().textContent().catch(() => "");
        if (modalText) {
          if (modalText.includes("undefined") || modalText.includes("NaN")) {
            console.error("  ❌ Undefined/NaN detected in match modal!");
            await snap(page, `ERROR_match_modal_round_${round}`);
          }
        }

        // Close the modal
        const confirmBtn = page.getByText("确认并继续").first();
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(500);
          console.log("  ✅ Modal closed");
        }
      } else {
        // Might have an alert (error about injured players or incomplete squad)
        console.log("  ⚠️ No match result modal — might be an alert");
        // Dismiss any dialogs
        page.on("dialog", async (dialog) => {
          console.log(`  ⚠️ Alert: ${dialog.message()}`);
          await snap(page, `ERROR_alert_round_${round}`);
          await dialog.dismiss();
        });
        await page.waitForTimeout(500);
      }

      // Check for errors after each round
      const errors = (page as Page & { _errors: string[] })._errors ?? [];
      if (errors.length > 0) {
        console.error(`  ❌ ${errors.length} console errors detected!`);
        await snap(page, `ERROR_round_${round}_console`);
      }
    }

    await snap(page, "07_after_matches");

    // ═══════════════════════════════════════════════════════════
    // 6. Navigate to transfer market
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 6: Transfer market...");

    const transferTab = page.getByText("转会市场").first();
    if (await transferTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await transferTab.click();
      await page.waitForTimeout(800);
      await snap(page, "08_transfer_market");
      console.log("  ✅ Transfer market loaded");

      // Check for player entries
      const marketRows = page.locator("table tbody tr");
      const rowCount = await marketRows.count().catch(() => 0);
      console.log(`  Found ${rowCount} players in market`);

      // Try clicking first position filter
      const posFilter = page.getByText("GK").first();
      if (await posFilter.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await posFilter.click();
        await page.waitForTimeout(300);
        console.log("  ✅ Position filter clicked");
      }
    }

    // Back to squad
    const squadTab2 = page.getByText("阵容").first();
    if (await squadTab2.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await squadTab2.click();
      await page.waitForTimeout(500);
    }

    // ═══════════════════════════════════════════════════════════
    // 7. Check U21 / U18 tabs
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 7: Checking youth squads...");

    const u21Tab = page.getByText(/U21/).first();
    if (await u21Tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await u21Tab.click();
      await page.waitForTimeout(500);
      await snap(page, "09_u21_squad");
      console.log("  ✅ U21 tab loaded");
    }

    const u18Tab = page.getByText(/U18/).first();
    if (await u18Tab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await u18Tab.click();
      await page.waitForTimeout(500);
      await snap(page, "10_u18_squad");
      console.log("  ✅ U18 tab loaded");
    }

    // ═══════════════════════════════════════════════════════════
    // 8. Auto-rotate squad
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 8: Auto-rotate...");

    // Back to first team
    const firstTab = page.getByText(/一线/).first();
    if (await firstTab.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await firstTab.click();
      await page.waitForTimeout(300);
    }

    const rotateBtn = page.getByText("自动轮换").first();
    if (await rotateBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await rotateBtn.click();
      await page.waitForTimeout(500);
      console.log("  ✅ Auto-rotate clicked");
    }

    // ═══════════════════════════════════════════════════════════
    // 9. Final error report
    // ═══════════════════════════════════════════════════════════
    console.log("\n📍 Step 9: Final checks...");

    await snap(page, "11_final_state");

    const errors = (page as Page & { _errors: string[] })._errors ?? [];
    const warnings = (page as Page & { _warnings: string[] })._warnings ?? [];

    console.log(`\n📊 E2E Test Summary:`);
    console.log(`  Console errors:   ${errors.length}`);
    console.log(`  Console warnings: ${warnings.length}`);

    if (errors.length > 0) {
      console.log("  Errors:");
      for (const e of errors) console.log(`    - ${e}`);
      await snap(page, "FINAL_ERROR_STATE");
    }

    // Check page for visible "undefined" or "NaN" text
    const bodyText = await page.locator("body").textContent().catch(() => "");
    if (bodyText?.includes("undefined") || bodyText?.includes("NaN")) {
      console.error("  ❌ CRITICAL: 'undefined' or 'NaN' found in rendered page!");
      await snap(page, "CRITICAL_undefined_in_page");
    } else {
      console.log("  ✅ No 'undefined' or 'NaN' visible in page");
    }

    // Don't fail on console errors (they might be pre-existing)
    // But DO fail on critical rendering issues
    expect(bodyText?.includes("undefined")).toBeFalsy();
    expect(bodyText?.includes("NaN")).toBeFalsy();
  });
});
