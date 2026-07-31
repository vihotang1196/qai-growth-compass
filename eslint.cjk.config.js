import tseslint from 'typescript-eslint';

/**
 * 只做一件事:禁止组件里出现硬编码的中日韩字符(PROGRESS.md D5)。
 * 独立成一个配置,是为了让它能挂进 `npm run build` 而不受其他 lint 规则干扰 ——
 * 代码风格问题不该阻断构建,硬编码文案该。
 *
 * 允许出现 CJK 的地方只有两处:
 *   src/config/**        ← ui-strings.ts 与 assessment-config.json
 *   注释                  ← 选择器只匹配字符串字面量与 JSX 文本,不匹配注释
 */
const CJK = '[\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af]';
const MESSAGE =
  'Hardcoded CJK text is not allowed here. Put the string in src/config/ui-strings.ts and read it via tk(), or take it from assessment-config.json via t(). See PROGRESS.md D5.';

export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/config/**'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
  rules: {
    'no-restricted-syntax': [
      'error',
      { selector: `JSXText[value=/${CJK}/]`, message: MESSAGE },
      { selector: `Literal[value=/${CJK}/]`, message: MESSAGE },
      { selector: `TemplateElement[value.raw=/${CJK}/]`, message: MESSAGE },
    ],
  },
});
