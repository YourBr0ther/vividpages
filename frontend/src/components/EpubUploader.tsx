import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import toast from 'react-hot-toast';
import { uploadEpub } from '../lib/api';

interface EpubUploaderProps {
  onUploadComplete: () => void;
}

export function EpubUploader({ onUploadComplete }: EpubUploaderProps) {
  const [uploading, setUploading] = useState(false);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];

    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.epub')) {
      toast.error('Please upload an EPUB file');
      return;
    }

    // Validate file size (50MB limit)
    if (file.size > 50 * 1024 * 1024) {
      toast.error('File size must be less than 50MB');
      return;
    }

    setUploading(true);

    try {
      // Upload the file
      const response = await uploadEpub(file);

      toast.success('Upload started! Processing your EPUB...');

      // Close upload modal and return to bookcase to see processing
      setUploading(false);
      onUploadComplete();

    } catch (error: any) {
      setUploading(false);

      // Handle duplicate error
      if (error.response?.status === 409) {
        const data = error.response.data;
        toast.error(
          `Duplicate file detected! You uploaded "${data.existingVividPage.title}" on ${new Date(data.existingVividPage.createdAt).toLocaleDateString()}`
        );
        return;
      }

      // Handle other errors
      const errorMessage = error.response?.data?.message || error.message || 'Upload failed';
      toast.error(errorMessage);
      console.error('Upload error:', error);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/epub+zip': ['.epub'],
    },
    multiple: false,
    disabled: uploading,
  });

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={
          isDragActive
            ? 'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition border-indigo-500 bg-indigo-50'
            : uploading
            ? 'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition border-gray-300 bg-gray-50 cursor-not-allowed'
            : 'border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition border-gray-300 hover:border-indigo-400 hover:bg-indigo-50'
        }
      >
        <input {...getInputProps()} />

        {isDragActive ? (
          <>
            <div className="text-6xl mb-4">📥</div>
            <p className="text-lg font-medium text-indigo-600">Drop your EPUB here...</p>
          </>
        ) : uploading ? (
          <>
            <div className="text-6xl mb-4">⏳</div>
            <p className="text-lg font-medium text-gray-600">Processing...</p>
            <p className="text-sm text-gray-500 mt-2">Please wait while we process your EPUB</p>
          </>
        ) : (
          <>
            <div className="text-6xl mb-4">📚</div>
            <p className="text-lg font-medium text-gray-800 mb-2">
              Drag & drop your EPUB file here
            </p>
            <p className="text-sm text-gray-500 mb-4">or click to browse</p>
            <p className="text-xs text-gray-400">
              Supported: .epub files up to 50MB
            </p>
          </>
        )}
      </div>
    </div>
  );
}
