import { Page, TestInfo } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

interface Step {
  num: number;
  description: string;
  notes: string;
  screenshotFile: string;
}

export class EvidenceCollector {
  private steps: Step[] = [];
  private readonly dir: string;
  private readonly id: string;
  private readonly title: string;

  constructor(id: string, title: string) {
    this.id = id;
    this.title = title;
    // Slugify the title for the directory name
    const slug = title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '');
    this.dir = path.join('docs', 'testing_evidences', `${id}-${slug}`);
    fs.mkdirSync(this.dir, { recursive: true });
  }

  /**
   * Execute an action, then take a screenshot and record the step.
   * If the action throws, the error propagates and the test fails —
   * no evidence is written for the failed step.
   * @param notes Optional explanatory text printed below the step heading in the evidence document.
   */
  async step(page: Page, num: number, description: string, action: () => Promise<void>, notes = ''): Promise<void> {
    await action();
    const filename = `step-${String(num).padStart(2, '0')}.png`;
    await page.screenshot({ path: path.join(this.dir, filename), fullPage: false });
    this.steps.push({ num, description, notes, screenshotFile: filename });
  }

  /**
   * Write the README.md for this test case.
   * Call this only after all steps have passed.
   */
  async generateReadme(testInfo: TestInfo): Promise<void> {
    const date = new Date().toISOString().split('T')[0];
    const browser = testInfo.project.name;

    const lines: string[] = [
      `# Test Case ${this.id} — ${this.title}`,
      '',
      `**Date:** ${date}  `,
      `**Status:** ✅ Pass  `,
      `**Browser:** ${browser}`,
      '',
      '---',
      '',
    ];

    for (const step of this.steps) {
      lines.push(`## Step ${step.num}: ${step.description}`, '');
      if (step.notes) lines.push(step.notes, '');
      lines.push('**Status:** ✅ Success', '');
      lines.push(`![Step ${step.num}](${step.screenshotFile})`, '');
      lines.push('---', '');
    }

    fs.writeFileSync(path.join(this.dir, 'README.md'), lines.join('\n'));
  }
}
