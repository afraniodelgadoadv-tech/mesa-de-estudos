# Mesa de Estudos

Cronômetro de estudos, tarefas, estatísticas, provas e bloco de notas. Os dados ficam no Firebase (Firestore) da conta do dono e sincronizam entre o site, o celular e a extensão.

- `src/` – código-fonte (o app é o mesmo no site e na extensão)
- `docs/` – site publicado pelo GitHub Pages (gerado)
- `extension/` – extensão para Chrome e Edge (gerada)
- `firestore.rules` – regras de acesso do banco

## Gerar

```
npm install
npm run build
```

## Instalar a extensão (Chrome ou Edge)

1. Abra `chrome://extensions` (ou `edge://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e escolha a pasta `extension`.
4. Fixe o ícone na barra (ícone de quebra-cabeça › alfinete).

Atalho: **Alt+Shift+E** abre o cronômetro.
