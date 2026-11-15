#!/usr/bin/env python3
"""Push the Google Play store listing in fastlane/metadata/android to Play.

Talks to the Google Play Developer API directly: fastlane supply will not
upload listing text or images unless a release with a known version code
sits on a track, which an app still in setup does not have.

Usage: PLAY_JSON='<service account key>' play_listing.py [--no-images]
"""
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PACKAGE = 'com.booruramen.app'
ROOT = Path(__file__).resolve().parents[2] / 'fastlane' / 'metadata' / 'android'
# fastlane file name -> Play image type
IMAGES = {
    'icon': 'icon',
    'featureGraphic': 'featureGraphic',
    'phoneScreenshots': 'phoneScreenshots',
    'sevenInchScreenshots': 'sevenInchScreenshots',
    'tenInchScreenshots': 'tenInchScreenshots',
}


def read(path):
    return path.read_text(encoding='utf-8').strip() if path.exists() else None


def main():
    with_images = '--no-images' not in sys.argv[1:]
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ['PLAY_JSON']),
        scopes=['https://www.googleapis.com/auth/androidpublisher'],
    )
    api = build('androidpublisher', 'v3', credentials=creds, cache_discovery=False)
    edits = api.edits()
    edit_id = edits.insert(packageName=PACKAGE, body={}).execute()['id']

    for lang_dir in sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith('.')):
        lang = lang_dir.name
        body = {
            'language': lang,
            'title': read(lang_dir / 'title.txt'),
            'shortDescription': read(lang_dir / 'short_description.txt'),
            'fullDescription': read(lang_dir / 'full_description.txt'),
        }
        body = {k: v for k, v in body.items() if v is not None}
        edits.listings().update(packageName=PACKAGE, editId=edit_id, language=lang, body=body).execute()
        print(f'{lang}: listing text updated')

        if not with_images:
            continue
        images_dir = lang_dir / 'images'
        for name, image_type in IMAGES.items():
            files = sorted(images_dir.glob(f'{name}/*.png')) + sorted(images_dir.glob(f'{name}/*.jpg'))
            files += [f for f in (images_dir / f'{name}.png', images_dir / f'{name}.jpg') if f.exists()]
            if not files:
                continue
            edits.images().deleteall(packageName=PACKAGE, editId=edit_id, language=lang, imageType=image_type).execute()
            for f in files:
                mime = 'image/png' if f.suffix == '.png' else 'image/jpeg'
                edits.images().upload(
                    packageName=PACKAGE, editId=edit_id, language=lang, imageType=image_type,
                    media_body=MediaFileUpload(str(f), mimetype=mime),
                ).execute()
            print(f'{lang}: {image_type} <- {len(files)} file(s)')

    edits.commit(packageName=PACKAGE, editId=edit_id).execute()
    print('Committed the listing edit.')


if __name__ == '__main__':
    main()
