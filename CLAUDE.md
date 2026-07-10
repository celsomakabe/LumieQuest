\# LumieQuest — CLAUDE.md



MMORPG offline browser-based estilo Ragnarok. Stack: HTML5 + Three.js 0.169.0 (importmap CDN, sem build) + JS ES6 puro, LocalStorage para save.



\## Regras Absolutas



\- \*\*R1.\*\* NUNCA reescreva um arquivo do zero. Entregue APENAS patches.

\- \*\*R2.\*\* Modifique so os modulos necessarios.

\- \*\*R3.\*\* Imports/exports explicitos.

\- \*\*R6.\*\* Performance: 60fps / 100 entidades / 50 draw calls / 16 audio.

\- \*\*R7.\*\* Arquitetura 5 camadas: js/core/, js/world/, js/entities/, js/systems/, js/ui/.

\- \*\*R8.\*\* Event bus (events.js) para conectar modulos. Imports diretos so com excecao documentada.

\- \*\*R9.\*\* JSDoc em funcoes publicas.

\- \*\*R10.\*\* Ao final de cada tarefa: listar arquivos modificados, exports novos, como testar.

\- \*\*R11.\*\* Sempre responda em português brasileiro.



\## Importmap



three: https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js

three/addons/: https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/



\## Regras de Terreno



\- terrainSize 800 intencional (ilusao de terreno infinito).

\- Player boundary +/-75 correto. NUNCA expandir para +/-400.

\- Monstros inacessiveis: limitar spawn a +/-75.



\## Excecoes R8 Documentadas



\- player.js importa combat.js direto

\- combat.js importa Classes direto

\- combat.js importa VFX direto

\- ui.js importa Combat/Player/Classes direto



\## SaveVersion



Atual: 10. Campo mp/maxMp (NAO sp/maxSp). classes.js ja existe com 12 jobs, nunca recriar.



\## Exports Novos (Sessao 30)



\- classes.js: getAttackRange(classId), isRangedClass(classId)

\- vfx.js: playProjectile(fromPos, toPos, options) alem de playEffect(type, pos, options)

\- player.js: debugSetClass(classId), ensureValidSpawn()



\## Comandos de Debug



\- window.debugSetClass(classId): troca classe/level/skills/HP-MP para testar VFX e combate sem upar. Ex: window.debugSetClass('mage'). Classes ranged: archer/hunter/sniper.

\- Overlay de profiling: tecla crase (backtick) mostra FPS / draw calls / triangulos.



\## Sistema de Combate



\- Range do ataque basico por classe: ranged (archer/hunter/sniper) = 20, melee = 3 (classes.js getAttackRange/isRangedClass).

\- Skills ranged range 18 (skills.json). Todas as 36 skills tem campo "type" (melee/ranged/magic/buff).

\- Aggro por dano: monstro atingido persegue o atacante, com leash (monsters.js).

\- Rotacao para o alvo no ataque basico e nas skills (player.js _facePoint).



\## VFX



\- vfx.js: playEffect (efeitos estaticos melee/ranged/magic/buff) e playProjectile (projetil viajando origem->alvo, com trail + PointLight).

\- Ataque basico ranged dispara projetil; skills ranged tambem. Wiring via evento skillCast em combat.js.



\## Mundo / Vegetacao



\- world.js suporta InstancedMesh para vegetacao GLTF via flag "instanced": true na entrada de decoration[] do maps.json (1 InstancedMesh por mesh/material; geometry/material compartilhados com o cache de models.js, NAO dar dispose).

\- forest_01 densificada (~2460 plantas) + anel externo decorativo (+/-75 a +/-200) para ilusao de mata infinita.

\- Terreno ainda plano (getGroundHeight=0). Relevo e Fase 4 futura.



\## Colisao e Spawn



\- Hitbox de estrutura = AABB do modelo encolhido em torno do centro real, fator por tipo (world.js COLLISION_SCALE_BY_TYPE; default 0.65) ou por entrada via campo "collisionScale" no maps.json.

\- Spawn inicial por mapa via campo "spawn" no maps.json (city_01 em area central 0,40). Validado apos loadMap popular as collision boxes (player.js ensureValidSpawn).

\- Muralhas (wall_*) ainda SEM colisao (exclusao pre-existente).



\## Pendencias Tecnicas



\- Player death handling

\- Shadow camera nao segue player

\- Textura de terreno por mapa

\- Bug de deteccao de exit points

\- Bug de dialogo de NPC

\- Monster spawn block em main.js marcado SESSAO 24: mover para world.js

