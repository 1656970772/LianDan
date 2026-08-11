import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const materialDirectory = path.join(projectRoot, "public", "assets", "materials");
const pillDirectory = path.join(projectRoot, "public", "assets", "pills");

const materials = [
  { file: "moyelian.png", motif: "inkLotus", primary: "#233d31", secondary: "#718b5e", accent: "#b9d49b" },
  { file: "shexian_guo.png", motif: "serpentFruit", primary: "#89ad77", secondary: "#d5be78", accent: "#e8e0ad" },
  { file: "juling_cao.png", motif: "spiritGrass", primary: "#4f9b67", secondary: "#7fd6a2", accent: "#d4f7b4" },
  { file: "water_core_2.png", motif: "waterCore", primary: "#2e7691", secondary: "#6ab7bd", accent: "#c7eff1" },
  { file: "ningxue_cao.png", motif: "bloodHerb", primary: "#6f2532", secondary: "#b45a55", accent: "#e6b586" },
  { file: "huoqi_guo.png", motif: "vitalFruit", primary: "#a64d37", secondary: "#d6884f", accent: "#f2ce78" },
  { file: "yingsu_hua.png", motif: "poppy", primary: "#873d56", secondary: "#d78a91", accent: "#e8c7a2" },
  { file: "shenggu_hua.png", motif: "boneFlower", primary: "#c8c09f", secondary: "#eee5bf", accent: "#91bb8a" },
  { file: "huiling_chiguo.png", motif: "spiritBerry", primary: "#a52e2d", secondary: "#da6551", accent: "#ffd17f" },
  { file: "xuelian_jing.png", motif: "bloodLotusCrystal", primary: "#7b1f35", secondary: "#d04a57", accent: "#f4a173" },
  { file: "bingling_yancao.png", motif: "frostFlameHerb", primary: "#388ba0", secondary: "#c45536", accent: "#d8f3e7" },
  { file: "qingti_cao.png", motif: "cleansingGrass", primary: "#67a98e", secondary: "#abd9b7", accent: "#e2f2c9" },
  { file: "binghuo_ronghun_guo.png", motif: "twinSoulFruit", primary: "#378eaa", secondary: "#c55a3f", accent: "#efd593" },
  { file: "shuiling_lianzi.png", motif: "lotusSeeds", primary: "#6aa899", secondary: "#bfcb92", accent: "#eef2c0" },
  { file: "hansui_zhi.png", motif: "marrowBranch", primary: "#75aeba", secondary: "#c3e7e2", accent: "#f3fff1" },
  { file: "huoling_gen.png", motif: "fireRoot", primary: "#934125", secondary: "#d57635", accent: "#f3c65c" },
  { file: "fire_core_3.png", motif: "fireCore", primary: "#8f3028", secondary: "#da6c38", accent: "#ffd169" },
  { file: "ice_core_2.png", motif: "iceCore", primary: "#3b7397", secondary: "#78b7ca", accent: "#d7f5ef" },
];

const pills = [
  { file: "juqi_san.png", motif: "gatheringPowder", primary: "#9aaa65", secondary: "#d7c98a", accent: "#eaf4bf" },
  { file: "ningxue_san.png", motif: "bloodPowder", primary: "#8d3440", secondary: "#c97867", accent: "#f1c48c" },
  { file: "huiqi_dan.png", motif: "returningQi", primary: "#438e82", secondary: "#7ac0a1", accent: "#d7eaa2" },
  { file: "shenggu_dan.png", motif: "boneMending", primary: "#c7bc91", secondary: "#eee2b4", accent: "#78aa82" },
  { file: "bingxin_dan.png", motif: "iceHeart", primary: "#4c91a5", secondary: "#9fcdd1", accent: "#e4f6e9" },
  { file: "xuelian_dan.png", motif: "bloodLotusPill", primary: "#8f2637", secondary: "#ce5255", accent: "#eda070" },
  { file: "qinghun_dan.png", motif: "clearSoul", primary: "#789b92", secondary: "#c7d7bb", accent: "#f2f0cd" },
  { file: "lihuo_dan.png", motif: "partingFlame", primary: "#633c45", secondary: "#b45c3f", accent: "#f0a74b" },
  { file: "residual_pill.png", motif: "residual", primary: "#6d7057", secondary: "#989677", accent: "#c2b887" },
  { file: "waste_pill.png", motif: "waste", primary: "#494841", secondary: "#716a58", accent: "#a08d68" },
  { file: "explosion.png", motif: "explosion", primary: "#772d26", secondary: "#cf6538", accent: "#f4bd59" },
];

const stem = (x1, y1, x2, y2, width = 8) =>
  `<path d="M ${x1} ${y1} Q ${(x1 + x2) / 2 - 8} ${(y1 + y2) / 2} ${x2} ${y2}" fill="none" stroke="url(#subject)" stroke-width="${width}" stroke-linecap="round"/>`;

const vein = (d) => `<path d="${d}" fill="none" stroke="#d9d6a0" stroke-opacity=".52" stroke-width="3" stroke-linecap="round"/>`;

const materialMotifs = {
  inkLotus: () => `
    ${stem(128, 205, 126, 82, 9)}
    <path d="M126 87 C83 51 49 74 57 119 C81 122 107 111 126 87Z" fill="url(#subject)" stroke="#b69458" stroke-width="4"/>
    <path d="M127 112 C165 67 207 82 199 129 C171 133 146 126 127 112Z" fill="url(#subjectAlt)" stroke="#b69458" stroke-width="4"/>
    <path d="M124 142 C86 112 55 130 68 169 C90 173 111 162 124 142Z" fill="#344f3e" stroke="#a9844d" stroke-width="4"/>
    ${vein("M64 113 Q94 101 122 88 M194 125 Q160 119 131 112 M74 163 Q101 151 121 143")}
    <circle cx="128" cy="79" r="12" fill="#c7b96f" opacity=".82"/>`,
  serpentFruit: () => `
    ${stem(124, 87, 102, 55, 7)}
    <path d="M103 60 C79 48 69 67 91 81 C108 91 126 87 139 75 C125 66 116 62 103 60Z" fill="#668b62" stroke="#b69458" stroke-width="3"/>
    <path d="M77 102 C53 137 77 193 126 196 C171 199 194 158 176 116 C160 79 101 70 77 102Z" fill="url(#subject)" stroke="#b69458" stroke-width="5"/>
    <path d="M87 113 C112 89 153 97 168 124 C149 115 133 119 119 135 C105 151 89 146 79 139" fill="none" stroke="#e5dc9f" stroke-opacity=".65" stroke-width="7" stroke-linecap="round"/>
    <circle cx="137" cy="157" r="7" fill="#efe0a5" opacity=".7"/>`,
  spiritGrass: () => `
    ${stem(128, 206, 129, 100, 8)}
    <path d="M127 185 C92 165 74 130 83 91 C111 111 126 142 127 185Z" fill="url(#subject)" stroke="#ad9155" stroke-width="4"/>
    <path d="M131 181 C164 156 179 123 170 82 C144 110 132 143 131 181Z" fill="url(#subjectAlt)" stroke="#ad9155" stroke-width="4"/>
    <path d="M126 150 C98 125 102 91 122 61 C137 90 138 121 126 150Z" fill="#78b77e" stroke="#b69458" stroke-width="4"/>
    <circle cx="121" cy="57" r="9" fill="#e8f8b5" filter="url(#glow)"/>
    <circle cx="82" cy="87" r="6" fill="#c7e9a2" filter="url(#glow)"/>
    <circle cx="171" cy="78" r="6" fill="#c7e9a2" filter="url(#glow)"/>`,
  waterCore: () => `
    <path d="M128 43 L184 77 L194 141 L158 198 L92 201 L54 148 L71 81Z" fill="url(#subject)" stroke="#c49b5d" stroke-width="5"/>
    <path d="M128 43 L135 116 L184 77 M135 116 L194 141 M135 116 L158 198 M135 116 L92 201 M135 116 L54 148 M135 116 L71 81Z" fill="none" stroke="#d9f1dc" stroke-opacity=".55" stroke-width="4"/>
    <path d="M97 92 C80 115 88 140 110 145 C95 127 105 110 126 93 C113 90 104 89 97 92Z" fill="#d9f4ef" opacity=".78"/>
    <circle cx="137" cy="117" r="14" fill="#d9f4ef" opacity=".55" filter="url(#glow)"/>`,
  bloodHerb: () => `
    ${stem(127, 205, 121, 69, 9)}
    <path d="M121 102 C86 79 61 97 66 130 C89 135 109 124 121 102Z" fill="url(#subject)" stroke="#b99258" stroke-width="4"/>
    <path d="M124 129 C164 96 194 112 188 149 C164 157 141 149 124 129Z" fill="url(#subjectAlt)" stroke="#b99258" stroke-width="4"/>
    <path d="M120 161 C87 141 62 157 71 187 C91 191 109 180 120 161Z" fill="#7d3440" stroke="#aa824c" stroke-width="4"/>
    <path d="M120 69 C108 82 109 93 122 104 C138 91 137 79 120 69Z" fill="#d9886d" stroke="#b99258" stroke-width="3"/>
    ${vein("M72 127 L117 105 M183 146 L130 132 M77 184 L116 164")}`,
  vitalFruit: () => `
    ${stem(128, 93, 127, 55, 7)}
    <path d="M127 62 C103 42 81 58 89 82 C103 88 118 80 127 62Z" fill="#5f845e" stroke="#b69458" stroke-width="3"/>
    <path d="M127 62 C149 45 171 59 166 82 C151 87 137 78 127 62Z" fill="#7a9b63" stroke="#b69458" stroke-width="3"/>
    <path d="M83 111 C58 151 85 199 128 200 C174 199 195 151 171 111 C149 78 105 78 83 111Z" fill="url(#subject)" stroke="#b69458" stroke-width="5"/>
    <path d="M128 94 C114 122 113 161 128 190 C143 161 143 122 128 94Z" fill="#e1a758" opacity=".36"/>
    <path d="M96 130 C111 113 145 111 161 129" fill="none" stroke="#f2cc77" stroke-width="5" stroke-linecap="round" opacity=".65"/>`,
  poppy: () => `
    ${stem(129, 206, 127, 112, 8)}
    <path d="M127 105 C100 110 73 99 67 75 C91 63 113 72 127 92 C139 66 166 61 188 76 C180 102 155 112 127 105Z" fill="url(#subject)" stroke="#b89056" stroke-width="4"/>
    <path d="M127 106 C106 86 105 57 126 42 C147 60 146 88 127 106Z" fill="url(#subjectAlt)" stroke="#b89056" stroke-width="4"/>
    <path d="M126 106 C105 128 75 128 62 107 C80 90 104 91 126 106Z" fill="#a55069" stroke="#b89056" stroke-width="4"/>
    <path d="M128 106 C150 127 181 128 194 106 C174 90 149 92 128 106Z" fill="#c76f7e" stroke="#b89056" stroke-width="4"/>
    <circle cx="127" cy="105" r="17" fill="#dfbd76" stroke="#6e4330" stroke-width="5"/>
    <path d="M102 168 C84 149 69 157 73 178 C89 184 103 178 113 165 M142 154 C164 136 181 148 177 168 C161 173 149 166 140 157" fill="#6c8c62" stroke="#aa824c" stroke-width="3"/>`,
  boneFlower: () => `
    ${stem(128, 207, 128, 118, 8)}
    <path d="M128 116 C102 107 79 89 78 65 C101 60 119 74 128 96 C138 72 158 59 181 66 C179 90 156 108 128 116Z" fill="url(#subject)" stroke="#a98652" stroke-width="4"/>
    <path d="M126 113 C105 131 77 132 61 114 C75 94 102 94 126 108 M131 113 C153 132 183 131 196 110 C180 92 154 94 131 108" fill="#ded7b5" stroke="#a98652" stroke-width="4"/>
    <circle cx="129" cy="111" r="15" fill="#8eb58b" stroke="#b89456" stroke-width="4"/>
    <path d="M128 143 L113 158 L128 172 L143 158Z M128 174 L114 188 L128 203 L142 188Z" fill="#e8e2c4" stroke="#9c7b4a" stroke-width="3"/>`,
  spiritBerry: () => `
    ${stem(127, 85, 132, 48, 7)}
    <path d="M130 54 C103 43 85 61 96 82 C111 86 124 73 130 54Z" fill="#60845d" stroke="#b58e50" stroke-width="3"/>
    <path d="M129 79 C96 62 70 89 76 126 C81 159 104 194 128 205 C152 193 176 159 181 125 C186 90 160 64 129 79Z" fill="url(#subject)" stroke="#bb9455" stroke-width="5"/>
    <path d="M102 101 C119 89 151 94 164 113" fill="none" stroke="#ffd078" stroke-opacity=".62" stroke-width="6" stroke-linecap="round"/>
    <circle cx="105" cy="140" r="7" fill="#e5855f"/><circle cx="143" cy="160" r="6" fill="#ef9a64"/>
    <path d="M128 202 C112 173 112 123 129 80 C148 124 146 174 128 202Z" fill="#6f1828" opacity=".25"/>`,
  bloodLotusCrystal: () => `
    <path d="M128 43 L156 79 L198 85 L178 124 L194 165 L151 172 L127 207 L102 172 L59 165 L77 124 L58 85 L99 79Z" fill="url(#subject)" stroke="#c39759" stroke-width="5"/>
    <path d="M128 43 L128 124 L156 79 M128 124 L198 85 M128 124 L178 124 M128 124 L194 165 M128 124 L151 172 M128 124 L127 207 M128 124 L102 172 M128 124 L59 165 M128 124 L77 124 M128 124 L58 85 M128 124 L99 79Z" fill="none" stroke="#f4b18a" stroke-opacity=".56" stroke-width="3"/>
    <circle cx="128" cy="124" r="21" fill="#ed725e" opacity=".62" filter="url(#glow)"/>`,
  frostFlameHerb: () => `
    ${stem(128, 207, 128, 98, 9)}
    <path d="M126 186 C87 164 75 128 87 88 C111 110 125 142 126 186Z" fill="#4c9db1" stroke="#b48b50" stroke-width="4"/>
    <path d="M131 185 C169 163 183 128 169 88 C146 111 132 143 131 185Z" fill="#bd593d" stroke="#b48b50" stroke-width="4"/>
    <path d="M127 133 C101 113 105 78 127 48 C149 78 154 112 130 134Z" fill="url(#subject)" stroke="#bf9455" stroke-width="4"/>
    <path d="M126 53 C116 78 116 106 127 127" fill="none" stroke="#d9f5ec" stroke-width="5" opacity=".72"/>
    <path d="M130 54 C142 79 142 106 131 128" fill="none" stroke="#f3b563" stroke-width="5" opacity=".74"/>
    <circle cx="128" cy="134" r="10" fill="#ede2a5" filter="url(#glow)"/>`,
  cleansingGrass: () => `
    ${stem(128, 209, 127, 94, 8)}
    <path d="M125 194 C101 178 83 151 81 112 C109 128 123 158 125 194Z" fill="url(#subject)" stroke="#aa8953" stroke-width="4"/>
    <path d="M132 193 C158 173 174 145 171 108 C147 127 133 158 132 193Z" fill="url(#subjectAlt)" stroke="#aa8953" stroke-width="4"/>
    <path d="M127 157 C104 129 107 89 129 55 C148 92 147 128 127 157Z" fill="#8cc0a0" stroke="#b58f55" stroke-width="4"/>
    ${vein("M126 188 Q105 154 86 119 M133 188 Q151 149 167 116 M127 151 Q128 103 129 61")}
    <circle cx="129" cy="53" r="8" fill="#edf3cb" filter="url(#glow)"/>`,
  twinSoulFruit: () => `
    ${stem(128, 86, 128, 51, 7)}
    <path d="M128 58 C99 45 77 61 87 86 C102 89 117 77 128 58Z" fill="#678963" stroke="#b58f55" stroke-width="3"/>
    <path d="M128 82 C88 74 66 108 77 152 C85 185 104 204 128 212 C151 203 171 184 180 151 C191 108 168 75 128 82Z" fill="url(#subject)" stroke="#c0995b" stroke-width="5"/>
    <path d="M128 83 C98 111 97 161 128 206Z" fill="#438fa8" opacity=".88"/>
    <path d="M128 83 C157 111 159 161 128 206Z" fill="#bc573e" opacity=".88"/>
    <path d="M128 91 C108 121 147 129 128 160 C111 186 141 195 128 206" fill="none" stroke="#f0d291" stroke-width="5" filter="url(#glow)"/>`,
  lotusSeeds: () => `
    ${stem(129, 209, 128, 144, 8)}
    <path d="M87 82 C96 52 159 51 171 81 L160 151 C149 171 105 171 94 151Z" fill="url(#subject)" stroke="#ad8952" stroke-width="5"/>
    <ellipse cx="129" cy="82" rx="42" ry="25" fill="#a8bd84" stroke="#b28f58" stroke-width="4"/>
    <circle cx="108" cy="75" r="8" fill="#edf0bc" stroke="#728b6b" stroke-width="3"/>
    <circle cx="130" cy="68" r="8" fill="#dce5a9" stroke="#728b6b" stroke-width="3"/>
    <circle cx="150" cy="79" r="8" fill="#eef0bd" stroke="#728b6b" stroke-width="3"/>
    <circle cx="119" cy="94" r="8" fill="#dce5a9" stroke="#728b6b" stroke-width="3"/>
    <circle cx="143" cy="99" r="8" fill="#eef0bd" stroke="#728b6b" stroke-width="3"/>
    <path d="M126 176 C99 156 78 167 79 192 C98 199 115 192 126 176Z M133 179 C158 159 181 170 179 195 C160 201 144 193 133 179Z" fill="#6c9b7b" stroke="#a9844d" stroke-width="4"/>`,
  marrowBranch: () => `
    <path d="M128 210 L126 121 L87 84 M126 139 L166 98 M126 169 L91 151 M126 113 L143 55" fill="none" stroke="url(#subject)" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M128 210 L126 121 L87 84 M126 139 L166 98 M126 169 L91 151 M126 113 L143 55" fill="none" stroke="#e1f5ec" stroke-opacity=".55" stroke-width="4" stroke-linecap="round"/>
    <path d="M82 87 L77 63 L98 76Z M165 99 L183 81 L178 106Z M91 151 L70 139 L78 162Z M143 57 L151 39 L159 63Z" fill="#bfe0df" stroke="#b58f55" stroke-width="3"/>
    <circle cx="127" cy="132" r="13" fill="#e5f7ee" opacity=".57" filter="url(#glow)"/>`,
  fireRoot: () => `
    <path d="M127 52 C103 74 99 99 111 122 C85 139 77 170 90 201 M129 116 C151 134 161 165 151 205 M113 121 C121 147 120 176 112 211 M140 83 C165 103 171 129 160 151" fill="none" stroke="url(#subject)" stroke-width="14" stroke-linecap="round"/>
    <path d="M127 52 C115 75 117 96 127 110 C140 95 142 74 127 52Z" fill="#efb752" stroke="#ad7f47" stroke-width="4"/>
    <path d="M90 201 L73 214 M112 211 L108 226 M151 205 L169 218 M160 151 L179 160" fill="none" stroke="#b64d2c" stroke-width="8" stroke-linecap="round"/>
    <path d="M126 62 Q109 96 125 135 Q145 169 136 199" fill="none" stroke="#f2c65c" stroke-width="4" opacity=".72" filter="url(#glow)"/>`,
  fireCore: () => `
    <path d="M128 40 L184 74 L196 135 L164 198 L98 207 L58 153 L67 86Z" fill="url(#subject)" stroke="#c39857" stroke-width="5"/>
    <path d="M128 40 L127 123 L184 74 M127 123 L196 135 M127 123 L164 198 M127 123 L98 207 M127 123 L58 153 M127 123 L67 86Z" fill="none" stroke="#f6c66a" stroke-opacity=".56" stroke-width="4"/>
    <path d="M129 73 C101 105 115 124 100 146 C116 144 127 138 132 126 C140 142 156 153 166 137 C176 120 155 93 129 73Z" fill="#f2ae45" stroke="#8d3428" stroke-width="4" filter="url(#glow)"/>
    <path d="M132 101 C118 120 128 128 127 139 C141 132 148 119 132 101Z" fill="#ffe091"/>`,
  iceCore: () => `
    <path d="M128 39 L178 70 L199 129 L167 194 L102 208 L56 157 L64 90Z" fill="url(#subject)" stroke="#c49b5d" stroke-width="5"/>
    <path d="M128 39 L128 128 L178 70 M128 128 L199 129 M128 128 L167 194 M128 128 L102 208 M128 128 L56 157 M128 128 L64 90Z" fill="none" stroke="#e8f8f2" stroke-opacity=".62" stroke-width="4"/>
    <path d="M128 70 L128 184 M80 99 L176 158 M80 158 L176 99 M128 84 L115 98 M128 84 L141 98 M128 172 L115 158 M128 172 L141 158" fill="none" stroke="#ddf5ef" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>`,
};

const pillBase = ({ fill = "url(#subject)", stroke = "#c09859", extra = "" } = {}) => `
  <circle cx="128" cy="128" r="70" fill="#080f0c" opacity=".5"/>
  <circle cx="128" cy="123" r="67" fill="${fill}" stroke="${stroke}" stroke-width="6"/>
  <ellipse cx="108" cy="91" rx="24" ry="14" fill="#fff9d7" opacity=".18"/>
  ${extra}`;

const pillMotifs = {
  gatheringPowder: () => `
    <path d="M72 139 Q128 91 184 139 L174 187 Q128 211 82 187Z" fill="#9a7650" stroke="#c09859" stroke-width="5"/>
    <ellipse cx="128" cy="139" rx="56" ry="26" fill="#e3d497" stroke="#c09859" stroke-width="5"/>
    <path d="M91 139 Q128 98 165 139 Q128 161 91 139Z" fill="url(#subject)"/>
    <circle cx="110" cy="128" r="4" fill="#e7f2bb"/><circle cx="139" cy="121" r="5" fill="#c7db8c"/><circle cx="151" cy="140" r="3" fill="#f0e3a0"/>
    <path d="M118 108 C103 92 108 73 128 61 C146 76 149 94 137 108" fill="none" stroke="#b5dd9a" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>`,
  bloodPowder: () => `
    <path d="M75 141 Q128 99 181 141 L173 188 Q128 207 83 188Z" fill="#8e6550" stroke="#c09859" stroke-width="5"/>
    <ellipse cx="128" cy="141" rx="53" ry="25" fill="#c37868" stroke="#c09859" stroke-width="5"/>
    <path d="M91 142 Q128 106 165 142 Q128 160 91 142Z" fill="url(#subject)"/>
    <path d="M128 58 C111 78 104 94 115 107 C123 117 140 113 145 101 C151 88 141 73 128 58Z" fill="#cf4850" stroke="#deb172" stroke-width="4" filter="url(#glow)"/>
    <circle cx="112" cy="137" r="4" fill="#f2c187"/><circle cx="143" cy="132" r="4" fill="#df9b76"/>`,
  returningQi: () => pillBase({ extra: `
    <path d="M87 133 C90 95 126 75 159 92 C176 101 183 117 179 135 C172 160 142 174 116 163 C98 156 88 143 87 133Z" fill="none" stroke="#dceaa6" stroke-width="8" stroke-linecap="round"/>
    <path d="M168 94 L158 119 L145 96Z" fill="#dceaa6"/>
    <circle cx="128" cy="123" r="10" fill="#e8f0ae" filter="url(#glow)"/>` }),
  boneMending: () => pillBase({ extra: `
    <path d="M94 101 C84 89 96 75 109 83 L128 103 L147 83 C160 75 172 89 162 101 L142 123 L163 145 C173 158 160 171 147 162 L128 143 L109 162 C96 171 83 158 94 145 L114 123Z" fill="#f0e5ba" stroke="#806c49" stroke-width="5"/>
    <path d="M105 123 H151 M128 99 V147" stroke="#79a783" stroke-width="6" stroke-linecap="round" filter="url(#glow)"/>` }),
  iceHeart: () => `
    <path d="M128 49 L183 82 L190 145 L150 196 L88 188 L61 128 L85 72Z" fill="url(#subject)" stroke="#c09a5d" stroke-width="6"/>
    <path d="M128 61 V181 M75 96 L181 155 M75 156 L180 94 M128 82 L110 100 M128 82 L146 100 M128 160 L110 144 M128 160 L146 144" fill="none" stroke="#e7f7ef" stroke-width="7" stroke-linecap="round"/>
    <circle cx="128" cy="122" r="14" fill="#f0fff3" opacity=".75" filter="url(#glow)"/>`,
  bloodLotusPill: () => pillBase({ extra: `
    <path d="M128 151 C104 139 91 119 95 94 C113 98 124 108 128 125 C133 107 146 97 165 95 C168 120 153 141 128 151Z" fill="#ee8a72" stroke="#71303a" stroke-width="4"/>
    <path d="M128 151 C108 161 88 154 78 137 C92 124 110 126 128 143 C146 125 164 124 178 137 C167 155 148 161 128 151Z" fill="#c83f50" stroke="#71303a" stroke-width="4"/>
    <circle cx="128" cy="145" r="10" fill="#f3bf77" filter="url(#glow)"/>` }),
  clearSoul: () => `
    <circle cx="128" cy="125" r="74" fill="none" stroke="#d7c58a" stroke-opacity=".55" stroke-width="4" stroke-dasharray="10 8"/>
    ${pillBase({ extra: `
      <path d="M128 76 C98 96 93 134 115 155 C128 168 150 165 164 151 C142 155 129 142 130 125 C131 107 147 94 164 96 C155 79 141 71 128 76Z" fill="#e7efd0" opacity=".8"/>
      <circle cx="126" cy="123" r="15" fill="#f6f1ca" filter="url(#glow)"/>` })}`,
  partingFlame: () => pillBase({ extra: `
    <path d="M128 73 C101 104 111 125 98 143 C91 157 103 177 125 179 C153 181 172 160 163 137 C157 119 141 105 146 84 C139 88 133 93 128 101 C126 91 126 82 128 73Z" fill="#dc6c3f" stroke="#65333d" stroke-width="5" filter="url(#glow)"/>
    <path d="M131 111 C114 132 122 144 117 155 C126 163 141 156 143 144 C145 133 137 124 131 111Z" fill="#f5bd54"/>` }),
  residual: () => pillBase({ fill: "url(#subject)", extra: `
    <path d="M125 58 L113 102 L132 117 L112 151 L125 189" fill="none" stroke="#3d4237" stroke-width="8" stroke-linejoin="round"/>
    <path d="M132 117 L160 99 M112 151 L86 143" fill="none" stroke="#3d4237" stroke-width="6" stroke-linecap="round"/>
    <circle cx="157" cy="150" r="6" fill="#c4b786" opacity=".55"/>` }),
  waste: () => `
    <path d="M73 178 C57 152 67 129 87 119 C74 95 92 70 117 76 C132 57 164 68 169 94 C193 101 197 129 180 145 C190 169 171 193 148 188 C128 204 93 197 73 178Z" fill="url(#subject)" stroke="#99764b" stroke-width="6"/>
    <path d="M88 144 Q104 126 118 145 T151 142 T175 151" fill="none" stroke="#3e4039" stroke-width="7" stroke-linecap="round"/>
    <circle cx="101" cy="104" r="7" fill="#aea077" opacity=".5"/><circle cx="150" cy="112" r="9" fill="#312f2b" opacity=".65"/>`,
  explosion: () => `
    <path d="M128 36 L146 83 L187 57 L174 107 L221 116 L179 141 L205 181 L158 171 L148 219 L122 177 L83 207 L91 158 L43 154 L82 126 L49 91 L98 99Z" fill="url(#subject)" stroke="#c79b59" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="129" cy="129" r="45" fill="#e9873d" opacity=".88" filter="url(#glow)"/>
    <circle cx="129" cy="129" r="23" fill="#f6d276"/>
    <path d="M95 65 Q78 46 67 62 M181 91 Q205 78 211 97 M72 183 Q52 196 63 212 M183 181 Q203 196 194 213" fill="none" stroke="#b8723c" stroke-width="7" stroke-linecap="round"/>`,
};

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function speckles(seedText) {
  let seed = hashString(seedText);
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  return Array.from({ length: 34 }, () => {
    const x = Math.round(22 + random() * 212);
    const y = Math.round(22 + random() * 212);
    const radius = (0.8 + random() * 2.2).toFixed(1);
    const opacity = (0.05 + random() * 0.11).toFixed(2);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#d9c590" opacity="${opacity}"/>`;
  }).join("");
}

function createSvg(definition, subject) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#10221c"/><stop offset=".55" stop-color="#142d24"/><stop offset="1" stop-color="#091511"/>
      </linearGradient>
      <radialGradient id="wash" cx="50%" cy="43%" r="64%">
        <stop offset="0" stop-color="#436451" stop-opacity=".36"/><stop offset="1" stop-color="#0b1713" stop-opacity="0"/>
      </radialGradient>
      <linearGradient id="subject" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${definition.accent}"/><stop offset=".47" stop-color="${definition.secondary}"/><stop offset="1" stop-color="${definition.primary}"/>
      </linearGradient>
      <linearGradient id="subjectAlt" x1="1" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${definition.accent}"/><stop offset=".55" stop-color="${definition.primary}"/><stop offset="1" stop-color="${definition.secondary}"/>
      </linearGradient>
      <filter id="grain" x="-20%" y="-20%" width="140%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency=".62" numOctaves="3" seed="${hashString(definition.file) % 97}" result="noise"/>
        <feColorMatrix in="noise" type="saturate" values="0" result="gray"/>
        <feComponentTransfer in="gray" result="soft"><feFuncA type="table" tableValues="0 .12"/></feComponentTransfer>
        <feBlend in="SourceGraphic" in2="soft" mode="soft-light"/>
      </filter>
      <filter id="glow" x="-100%" y="-100%" width="300%" height="300%">
        <feGaussianBlur stdDeviation="4" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <filter id="shadow" x="-30%" y="-30%" width="160%" height="180%">
        <feDropShadow dx="0" dy="7" stdDeviation="6" flood-color="#020806" flood-opacity=".72"/>
      </filter>
    </defs>
    <rect width="256" height="256" rx="30" fill="url(#background)"/>
    <rect x="9" y="9" width="238" height="238" rx="25" fill="none" stroke="#a77e47" stroke-width="4"/>
    <rect x="17" y="17" width="222" height="222" rx="20" fill="none" stroke="#d0ae6b" stroke-opacity=".38" stroke-width="2"/>
    <circle cx="128" cy="126" r="96" fill="url(#wash)" stroke="#50715d" stroke-opacity=".25" stroke-width="2"/>
    ${speckles(definition.file)}
    <g filter="url(#shadow)">${subject}</g>
    <rect x="20" y="20" width="216" height="216" rx="18" fill="none" stroke="#09140f" stroke-opacity=".5" stroke-width="2" filter="url(#grain)"/>
    <path d="M29 53 V30 H52 M204 30 H227 V53 M29 202 V225 H52 M204 225 H227 V202" fill="none" stroke="#c49a5a" stroke-width="3" stroke-linecap="round" opacity=".8"/>
  </svg>`;
}

async function renderSet(definitions, motifs, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  for (const definition of definitions) {
    const motif = motifs[definition.motif];
    if (!motif) {
      throw new Error(`Unknown motif: ${definition.motif}`);
    }
    const svg = createSvg(definition, motif(definition));
    await sharp(Buffer.from(svg))
      .resize(256, 256, { fit: "fill" })
      .png({ compressionLevel: 9, palette: true, quality: 100 })
      .toFile(path.join(outputDirectory, definition.file));
  }
}

await renderSet(materials, materialMotifs, materialDirectory);
await renderSet(pills, pillMotifs, pillDirectory);

console.log(`Generated ${materials.length} material icons in ${materialDirectory}`);
console.log(`Generated ${pills.length} pill/result icons in ${pillDirectory}`);
