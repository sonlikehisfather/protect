# Guide de Contribution

Merci de votre intérêt pour contribuer à mysoul !

## Comment Contribuer

### Signaler un Bug

1. Vérifiez que le bug n'est pas déjà signalé
2. Ouvrez une [Issue](https://github.com/sonlikehisfather/protect/issues)
3. Utilisez le template :
   - Description du bug
   - Étapes pour reproduire
   - Comportement attendu vs réel
   - Screenshots (si applicable)
   - Environnement (Node.js version, OS)

### Proposer une Fonctionnalité

1. Ouvrez une Issue avec le label `enhancement`
2. Décrivez la fonctionnalité
3. Expliquez pourquoi elle serait utile

### Soumettre du Code

1. **Fork** le repository
2. **Créer une branche** : `git checkout -b feature/ma-feature`
3. **Commiter** : `git commit -m 'Ajout de la feature'`
4. **Pusher** : `git push origin feature/ma-feature`
5. **Ouvrir une Pull Request**

---

## Standards de Code

### Style de Code

- Utilisez `camelCase` pour les variables et fonctions
- Utilisez `PascalCase` pour les classes
- Utilisez `UPPER_SNAKE_CASE` pour les constantes
- Indentation : 2 espaces
- Pas de `var`, utilisez `const` ou `let`

### Commits

Format : `<type>: <description>`

Types :
- `feat` : Nouvelle fonctionnalité
- `fix` : Correction de bug
- `docs` : Documentation
- `style` : Formatage (pas de changement de code)
- `refactor` : Refactoring
- `perf` : Performance
- `test` : Tests
- `chore` : Maintenance

Exemples :
```
feat: ajout de la commande +slowmode
fix: correction du mute sur les gros serveurs
docs: mise à jour du README
```

### Tests

- Ajoutez des tests pour les nouvelles fonctionnalités
- Assurez-vous que tous les tests passent
- Maintenez la couverture de code

```bash
npm test
```

---

## Structure du Projet

```
mysoul/
├── commands/     # Commandes
├── events/       # Événements
├── modules/      # Modules avancés
├── utils/        # Utilitaires
├── core/         # Noyau
└── docs/         # Documentation
```

### Ajouter une Commande

1. Créer `commands/[catégorie]/nomCommande.js`
2. Suivre le template :

```javascript
'use strict';

module.exports = {
  name: 'nomCommande',
  description: 'Description',
  usage: '<arg>',
  
  async execute(message, args, client) {
    // Implémentation
  }
};
```

3. Tester localement
4. Documenter dans `docs/commands/`

### Ajouter un Événement

1. Créer `events/nomEvenement.js`
2. Suivre le template :

```javascript
'use strict';

module.exports = {
  name: 'nomEvenement',
  once: false,
  
  async execute(arg1, client) {
    // Implémentation
  }
};
```

---

## Code Review

Les PR seront reviewées sur :
- Fonctionnalité
- Qualité du code
- Tests
- Documentation
- Bonnes pratiques Discord.js

### Checklist PR

- [ ] Le code fonctionne comme attendu
- [ ] Pas de `console.log` de debug
- [ ] Gestion des erreurs en place
- [ ] Documentation à jour
- [ ] Pas de conflits de merge

---

## Communauté

- Respectez le Code de Conduite
- Soyez bienveillant dans les discussions
- Aidez les autres contributeurs

## Questions ?

Ouvrez une Issue avec le label `question` ou rejoignez notre serveur Discord.

---

Merci de contribuer ! 🎉
