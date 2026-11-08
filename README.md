# 🎳 BOWLING 2600 DELUXE — Remaster & Engenharia Reversa

> **Remaster por [@realzurr](https://github.com/realzurr)**  
> 🌐 **Jogue Online Agora (GitHub Pages):** **[https://realzurr.github.io/bowling/](https://realzurr.github.io/bowling/)**  
> Recriação moderna para navegador (HTML5 Canvas + Web Audio API) a partir da engenharia reversa do binário original **`Bowling.bin` (Atari 2600, 1979 — Larry Kaplan)**.

---

## ✨ Sobre o Projeto

Este projeto nasceu da análise e desmontagem (*disassembly* 6502) da ROM clássica de **2048 bytes (`Bowling.bin`)** do Atari 2600. O objetivo foi preservar **100% das regras, variações de jogo, física de deflexão dos pinos e sistema de pontuação originais**, vestindo o jogo com **gráficos modernos em alta definição** e **áudio procedural estéreo** — permitindo inclusive alternar em tempo real entre o modo **Moderno HD** e o modo **Clássico Atari 2600 CRT**.

---

## 🕹️ Funcionalidades Principais

- **6 Variações Oficiais do Jogo (Tabela ROM `$F7B2`):**
  - **Jogo 1 (1P) & Jogo 2 (2P) — *Curve Ball* (Bola com Curva):** Após o lançamento da bola, pressione *Cima* ou *Baixo* uma única vez para travar o efeito curvo naquela direção até o fim da pista (registrador `$90`).
  - **Jogo 3 (1P) & Jogo 4 (2P) — *Steerable Ball* (Bola Dirigível):** Permite controlar e guiar a bola livremente para cima e para baixo durante todo o trajeto na pista.
  - **Jogo 5 (1P) & Jogo 6 (2P) — *Straight Ball* (Bola Reta):** A bola segue estritamente em linha reta após o arremesso; exige máxima precisão no posicionamento inicial.
- **Chaves de Dificuldade A / B Individuais (Tabela ROM `$F7A6`):**
  - **Dificuldade B (Normal):** Usa os índices pares da tabela de velocidade dos pinos (`$F7A6`), gerando maior espalhamento lateral e facilitando *Strikes*.
  - **Dificuldade A (Pro / Expert):** Ativa os índices ímpares da tabela de deflexão, exigindo acertar o *pocket* (entre os pinos 1–3 ou 1–2) com precisão para derrubar todos os 10 pinos.
- **Gráficos Duplos (Alternáveis em Tempo Real via tecla `V`):**
  - **Modo Moderno HD:** Pista de madeira *maple* com reflexos dinâmicos, setas de mira, bola 3D com furos rotativos e rastro de efeito, boneco articulado com a bola junto às mãos na linha exata do arremesso, pinos numerados com física de rotação e partículas de impacto.
  - **Modo Clássico Atari 2600 CRT:** Renderiza os *sprites* originais de 12 linhas extraídos diretamente dos endereços `$F7B8`, `$F7C8` e `$F7D8` da ROM, cores autênticas NTSC (`$F722`) e filtro *scanlines* de TV de tubo.
- **Motor de Áudio Duplo (Web Audio API):**
  - **Modo Moderno Stereo:** Som de impacto da bola na madeira, rolagem contínua com *panning* estéreo acompanhando a bola da esquerda para a direita, impacto em múltiplas camadas dos pinos de madeira e fanfarras de comemoração.
  - **Modo Atari TIA 2600:** Síntese fiel aos registradores `AUDC0`/`AUDF0` (`$0F` — ruído da bola rolando) e `AUDC1`/`AUDF1` (`$0C` — *sweep* sonoro de colisão dos pinos em `$F688–$F6AB`).
- **Placar Oficial de 10 Frames + 🏆 Top 5 Recordes:**
  - Contagem oficial de *Strike* (`X`), *Spare* (`/`), *Frame Aberto* e jogadas bônus no 10º Frame (pontuação máxima de **300 pontos**), além dos marcadores gráficos clássicos do Atari (`▬`, `▮`, `█`).
  - **Hall da Fama (Top 5 Recordes)** sempre visível na tela, com registro de **até 5 letras (iniciais)** seguido pela pontuação e persistência via `localStorage`.

---

## 🔬 Detalhes da Engenharia Reversa (`Bowling.bin`)

| Endereço na ROM | Função / Tabela Extraída |
| :--- | :--- |
| `$F7B2` (6 bytes) | Máscaras de bits das 6 variações (`00, 80, 40, C0, 20, A0`): Bit 7 = 2 Jogadores, Bit 6 = *Steerable*, Bit 5 = *Straight*. |
| `$F78A` & `$F794` | Coordenadas iniciais verticais (`AF`) e horizontais (`B9`) dos 10 pinos em formação triangular (`X = 7, 5, 3, 1`). |
| `$F7A6` (12 bytes) | Tabela de vetores de velocidade dos pinos (`0F, 1E, 1F, 3F, 2F, 10, 10, 21, 31, 11, 12, 01`) indexada pelo ponto de impacto e chave de dificuldade A/B. |
| `$F3A0–$F3D7` | Rotina de colisão Bola → Pino e deflexão vertical da bola (`DEC $A9` / `INC $A9`). |
| `$F41D–$F439` | Rotina de reação em cadeia Pino → Pino (transfere o byte de velocidade `$C3,X` quando `B9[Y] == B9[X]` e `|AF[Y] - AF[X]| ≤ 2`). |
| `$F7B8–$F7E7` | *Bitmaps* originais dos 3 quadros de animação do jogador (postura, *backswing* e arremesso/comemoração). |
| `$F688–$F6AB` | Rotina de áudio do chip TIA para rolagem da bola e impacto dos pinos. |

---

## 🎮 Controles

| Ação | Teclado | Mouse / Touch / Gamepad |
| :--- | :--- | :--- |
| **Posicionar Jogador / Aplicar Efeito** | `↑` / `↓` ou `W` / `S` | Botões `▲ CIMA` / `▼ BAIXO` ou *D-Pad* |
| **Arremessar Bola** | `ESPAÇO` ou `ENTER` | Botão `🎳 ARREMESSAR` ou Botão `A` |
| **Alternar Variação do Jogo (1–6)** | `G` | Seletor `MODO DE JOGO (SELECT)` |
| **Alternar Visual (Moderno HD / Atari CRT)** | `V` | Botão `VISUAL` |
| **Reiniciar Partida (Reset)** | `R` | Botão `🔄 NOVO JOGO` |

---

## 🚀 Como Executar

Não há necessidade de instalar dependências ou *bundlers*. Basta abrir o arquivo `index.html` diretamente no navegador ou servir a pasta com qualquer servidor estático:

```bash
# Opção 1: Abrir diretamente
start index.html

# Opção 2: Servidor HTTP local (Python / Node)
python -m http.server 8080
```

---

## 📁 Estrutura de Arquivos

- `Bowling.bin` — Binário original de 2 KB do Atari 2600 utilizado como base na engenharia reversa.
- `index.html` — Estrutura da aplicação, placar de 10 frames, painel Top 5 Recordes e modais.
- `styles.css` — Estilização visual neon/arcade, responsividade e efeito CRT *scanlines*.
- `audio.js` — Sintetizador duplo Web Audio API (Moderno Stereo + Emulação TIA 2600).
- `game.js` — Motor de física, colisão, pontuação, recordes e renderizador duplo (HD + Clássico).

---

## 👤 Autor do Remaster

Desenvolvido por **[realzurr](https://github.com/realzurr)** (`github.com/realzurr`).  
Jogo original *Bowling* (Atari 2600, 1979) programado por **Larry Kaplan**.
