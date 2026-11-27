# 0013 : images des questions dans un bucket S3, leur URL dans la question

- Statut : acceptée
- Date : 2026-11-27

## Contexte

Une question peut être illustrée par une image, affichée derrière l'énoncé sur l'écran projeté. Il faut stocker des fichiers envoyés par les animateurs, en dev comme en production.

## Options envisagées

1. **Les octets dans Postgres** (une table `images`) : aucune infrastructure nouvelle, mais la base grossit de fichiers qu'elle n'a pas à interroger, et chaque affichage passe par elle.
2. **Un volume attaché à l'API** : le moins de code, mais l'API devient un service avec état : une seule instance, une coupure à chaque redéploiement, pas de sauvegarde.
3. **Un bucket compatible S3**, et l'URL de l'image dans la question.

## Décision

Option 3.

- En production, un bucket Railway, déclaré dans `.railway/railway.ts`. En dev et en CI, `adobe/s3mock` : MinIO ne publie plus d'image Docker.
- Les buckets Railway sont privés : l'API est seule à y écrire et à y lire. Elle signe ses requêtes avec `aws4fetch` (SigV4, sans dépendance) plutôt qu'avec le SDK AWS. Le bucket est adressé par chemin : `S3_BUCKET_URL` vaut `{endpoint}/{bucket}`.
- `POST /api/images`, réservé aux animateurs connectés : le corps de la requête est le fichier lui-même, JPEG, PNG ou WebP, de 2 Mo au plus. Pas de SVG, qui peut contenir du script. Le fichier est nommé d'un UUID suivi de son type.
- La question porte `imageUrl` (`/api/images/{uuid}.{type}`), dans le `jsonb` du quiz (ADR 0009). Le protocole n'accepte que ces URL, jamais l'image d'un site tiers.
- `GET /api/images/:clé` est public, puisque le nom ne se devine pas, et mis en cache sans expiration (`immutable`) : une image ne change jamais sous le même nom.

## Conséquences

- L'API reste sans état et peut passer à plusieurs instances.
- Les images transitent par l'API. Des URL présignées éviteraient ce trafic, mais elles expirent et ne peuvent pas être stockées dans la question. Seul l'écran projeté affiche les images, une fois par question : le volume reste faible.
- Une image retirée d'une question, ou celle d'un quiz supprimé, reste dans le bucket jusqu'au passage du `worker` : chaque nuit, il supprime les images de plus d'un jour qu'aucun quiz ni aucune partie n'utilise. Pour les trouver sans lister le bucket, l'API inscrit chaque image envoyée dans la table `images`.
- Le bucket n'est pas sauvegardé.
- `adobe/s3mock` ne vérifie pas les signatures : c'est le déploiement qui valide l'accès au vrai bucket.
