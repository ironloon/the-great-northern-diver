import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { MANAGED_FILES } from "./install.js";

const workflowTemplateRoot = path.resolve(import.meta.dirname, "..", "templates", "workflow");
const navigatorTemplatePath = path.join(workflowTemplateRoot, "agents", "gnd-navigator.agent.md");
const chartSkillPath = path.join(workflowTemplateRoot, "skills", "gnd-chart", "SKILL.md");

function frontmatterContains(content, text) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match !== null && match[1].includes(text);
}

test("navigator and chart templates declare dispatch-gating contracts in frontmatter", async () => {
  const [navigatorTemplate, chartSkill] = await Promise.all([
    readFile(navigatorTemplatePath, "utf8"),
    readFile(chartSkillPath, "utf8")
  ]);

  assert.ok(frontmatterContains(chartSkill, "navigator-gates-unconfirmed"),
    "chart skill should declare navigator-gates-unconfirmed contract");
  assert.ok(frontmatterContains(navigatorTemplate, "confirmed-legs-required"),
    "navigator should declare confirmed-legs-required contract");
  assert.ok(frontmatterContains(navigatorTemplate, "mark-in-progress-before-dispatch"),
    "navigator should declare mark-in-progress-before-dispatch contract");
  assert.ok(frontmatterContains(navigatorTemplate, "resume-in-progress-legs"),
    "navigator should declare resume-in-progress-legs contract");

  assert.match(chartSkill, /Navigator won't dispatch/);
  assert.match(navigatorTemplate, /`pending`.*`Confirmed: yes`/);
});

test("navigator template enforces in-progress marking before dispatch", async () => {
  const navigatorTemplate = await readFile(navigatorTemplatePath, "utf8");
  const markInProgressIndex = navigatorTemplate.indexOf("**Mark in-progress.**");
  const dispatchIndex = navigatorTemplate.indexOf("**Dispatch.**");

  assert.notEqual(markInProgressIndex, -1, "template should contain mark in-progress step");
  assert.notEqual(dispatchIndex, -1, "template should contain dispatch step");
  assert.ok(markInProgressIndex < dispatchIndex, "mark in-progress must precede dispatch");
});

test("templates do not ship with YAML frontmatter (injected at install time)", async () => {
  for (const relativePath of MANAGED_FILES) {
    const content = await readFile(path.join(workflowTemplateRoot, relativePath), "utf8");

    assert.ok(!content.startsWith("---\n"),
      `${relativePath} must not contain frontmatter; provenance is injected by the installer`);
  }
});