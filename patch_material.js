const fs = require('fs');
const file = 'js/entities/monsters.js';
let code = fs.readFileSync(file, 'utf8');
if (code.charCodeAt(0) === 0xFEFF) code = code.slice(1);

// 1) Adicionar helpers após os imports (após linha "// Estado interno")
const stateMarker = '// \u2500\u2500\u2500 Estado interno';
const helpers = 
// --- helpers de material para glTF/Group ---

function _getMeshMaterial(mesh) {
    if (!mesh) return null;
    if ((mesh.isMesh || mesh.isSkinnedMesh) && mesh.material) {
        return Array.isArray(mesh.material) ? (mesh.material[0] ?? null) : mesh.material;
    }
    let foundMaterial = null;
    mesh.traverse((child) => {
        if (foundMaterial) return;
        if ((child.isMesh || child.isSkinnedMesh) && child.material) {
            foundMaterial = Array.isArray(child.material) ? (child.material[0] ?? null) : child.material;
        }
    });
    return foundMaterial;
}

function _getMeshColor(mesh) {
    const material = _getMeshMaterial(mesh);
    return material?.color ?? null;
}

function _getMeshEmissive(mesh) {
    const material = _getMeshMaterial(mesh);
    return material?.emissive ?? null;
}

;
code = code.replace(stateMarker, helpers + stateMarker);

// 2) Linha 360 area: m.mesh.material.color.set(new THREE.Color(
code = code.replace(
    /m\.mesh\.material\.color\.set\(new THREE\.Color\(\s*_catalogue\[m\.monsterId\]\?\.modelPlaceholder \?\? '#ffffff'\s*\)\);/g,
    {
                const __mc = _getMeshColor(m.mesh);
                if (__mc && m._originalColor) { __mc.copy(m._originalColor); }
                else if (__mc) { __mc.set(new THREE.Color(_catalogue[m.monsterId]?.modelPlaceholder ?? '#ffffff')); }
            }
);

// 3) m.mesh.material.emissiveIntensity = 0.95
code = code.replace(
    'm.mesh.material.emissiveIntensity = 0.95;',
    '{ const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.95; }'
);

// 4) boss_lord_knight enrage
code = code.replace(
    'm.mesh.material.emissive.set(0xff3333);\n            m.mesh.material.emissiveIntensity = 0.9;',
    '{ const __em = _getMeshEmissive(m.mesh); if (__em) __em.set(0xff3333); const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.9; }'
);

// 5) boss_high_wizard reflect permanent
code = code.replace(
    'm.mesh.material.emissiveIntensity = 1.0;',
    '{ const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 1.0; }'
);

// 6) boss_shadow_assassin abyss
code = code.replace(
    'm.mesh.material.emissive.set(0x7a1fa2);\n            m.mesh.material.emissiveIntensity = 0.9;',
    '{ const __em = _getMeshEmissive(m.mesh); if (__em) __em.set(0x7a1fa2); const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.9; }'
);

// 7) _startTelegraph color
code = code.replace(
    'm.mesh.material.color.set(0xff2200);',
    '{ const __mc = _getMeshColor(m.mesh); if (__mc) { if (!m._originalColor) m._originalColor = __mc.clone(); __mc.set(0xff2200); } }'
);

// 8) reflectShield emissiveIntensity = 0.8
code = code.replace(
    'm.mesh.material.emissiveIntensity = 0.8;',
    '{ const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.8; }'
);

// 9) reflectShield reset emissiveIntensity = 0.3 (inside setTimeout)
code = code.replace(
    /m\._reflectShield = false;\s*\n\s*m\.mesh\.material\.emissiveIntensity = 0\.3;/,
    'm._reflectShield = false;\n                        { const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.3; }'
);

// 10) clone.material.dispose() → safe
code = code.replace(
    /clone\.geometry\.dispose\(\);\s*\n\s*clone\.material\.dispose\(\);/g,
    'clone.geometry?.dispose?.();\n        if (Array.isArray(clone.material)) { clone.material.forEach(mat => mat?.dispose?.()); } else { clone.material?.dispose?.(); }'
);

// 11) cloneMesh.material.dispose() → safe
code = code.replace(
    /cloneMesh\.geometry\.dispose\(\);\s*\n\s*cloneMesh\.material\.dispose\(\);/g,
    'cloneMesh.geometry?.dispose?.();\n            if (Array.isArray(cloneMesh.material)) { cloneMesh.material.forEach(mat => mat?.dispose?.()); } else { cloneMesh.material?.dispose?.(); }'
);

// 12) drop.mesh.material.dispose() → safe
code = code.replace(
    /drop\.mesh\.geometry\.dispose\(\);\s*\n\s*drop\.mesh\.material\.dispose\(\);/g,
    'drop.mesh.geometry?.dispose?.();\n    if (Array.isArray(drop.mesh.material)) { drop.mesh.material.forEach(mat => mat?.dispose?.()); } else { drop.mesh.material?.dispose?.(); }'
);

// 13) summonAdds: remove access to add.mesh.position
code = code.replace(
    /const add = spawnMonster\('goblin',/g,
    "spawnMonster('goblin',"
);
code = code.replace(
    /summonedId: add\?\.id \?\? null,\s*\n\s*position: add \? \{\s*\n\s*x: add\.mesh\.position\.x,\s*\n\s*y: add\.mesh\.position\.y,\s*\n\s*z: add\.mesh\.position\.z,\s*\n\s*\} : null,/g,
    'summonedMonsterId: "goblin",'
);

// 14) _respawn: fix emissive/material reset
code = code.replace(
    /m\.str\s*=\s*m\.baseStats\.str;\s*\n\s*m\.mesh\.material\.emissive\.set\(new THREE\.Color\(_catalogue\[m\.monsterId\]\?\.modelPlaceholder \?\? '#ffffff'\)\);\s*\n\s*m\.mesh\.material\.emissiveIntensity = 0\.3;/,
    m.str = m.baseStats.str;
    { const __em = _getMeshEmissive(m.mesh); if (__em) __em.set(new THREE.Color(_catalogue[m.monsterId]?.modelPlaceholder ?? '#ffffff')); }
    { const __mat = _getMeshMaterial(m.mesh); if (__mat && "emissiveIntensity" in __mat) __mat.emissiveIntensity = 0.3; }
    { const __mc = _getMeshColor(m.mesh); if (__mc && m._originalColor) __mc.copy(m._originalColor); }
);

fs.writeFileSync(file, code, 'utf8');

// Verificar que não restam acessos diretos a .material.
const remaining = code.split('\n').filter((line, i) => {
    return /m\.mesh\.material\.|clone\.material\.|cloneMesh\.material\.|drop\.mesh\.material\./.test(line)
        && !/\/\//.test(line.split(/material/)[0]);
});
if (remaining.length > 0) {
    console.log('AVISO - ainda restam acessos diretos:');
    remaining.forEach(l => console.log('  ', l.trim()));
} else {
    console.log('OK - todos os acessos a .material substituidos por helpers');
}
