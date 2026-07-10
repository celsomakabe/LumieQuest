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



\## Pendencias Tecnicas



\- Player death handling

\- Shadow camera nao segue player

\- Textura de terreno por mapa

\- Bug de deteccao de exit points

\- Bug de dialogo de NPC

\- Monster spawn block em main.js marcado SESSAO 24: mover para world.js

